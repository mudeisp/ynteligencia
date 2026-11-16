import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const hex64 = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Read-only verification of an immutable national manifest against the persisted
 * ledger. No SHA-of-hashes substitution: both SHA-256 digests are computed from
 * the original, ordered UTF-8 bytes. The caller must fetch all ledger fragments
 * and target pages from the frozen UUID, using an authenticated read-only source.
 *
 * This module intentionally DOES NOT emit an audit seal, grant authorization,
 * change national_control, or write any production data.
 */
export async function verifyFrozenNationalSeal({
  bytes, manifestHash, runUuid, fragments, targetPages, parseAndValidateManifest,
  maxPartCharacters = 131072, maxPageSize = 50,
}) {
  if (!Buffer.isBuffer(bytes) || !hex64.test(manifestHash || '') || !uuid.test(runUuid || ''))
    throw Error('SEAL_INVALID_INPUT');
  if (sha256(bytes) !== manifestHash) throw Error('SEAL_SOURCE_DOCUMENT_HASH_MISMATCH');
  if (typeof parseAndValidateManifest !== 'function') throw Error('SEAL_VALIDATOR_REQUIRED');
  const document = parseAndValidateManifest(bytes, manifestHash);
  if (!document || document.operationUuid !== runUuid || document.id !== 'national-v2-once'
    || !Array.isArray(document.targets) || document.targets.length === 0)
    throw Error('SEAL_DOCUMENT_IDENTITY_MISMATCH');

  // The original sender fragments the JS UTF-16 string at 131072 code units.
  // Compare exact slices, then hash the reconstituted UTF-8 stream in order.
  const fullText = bytes.toString('utf8');
  if (!Buffer.from(fullText, 'utf8').equals(bytes)) throw Error('SEAL_NONCANONICAL_UTF8');
  let partNumber = 0;
  let textOffset = 0;
  const persistedHash = createHash('sha256');
  for await (const item of fragments) {
    if (!item || item.part !== partNumber || typeof item.text !== 'string'
      || item.text.length < 1 || item.text.length > maxPartCharacters)
      throw Error('SEAL_FRAGMENT_SEQUENCE_INVALID');
    if (item.text !== fullText.slice(textOffset, textOffset + item.text.length))
      throw Error('SEAL_FRAGMENT_BYTES_DIVERGE');
    persistedHash.update(item.text, 'utf8');
    textOffset += item.text.length;
    partNumber += 1;
  }
  if (partNumber === 0 || textOffset !== fullText.length || persistedHash.digest('hex') !== manifestHash)
    throw Error('SEAL_LEDGER_DOCUMENT_HASH_MISMATCH');

  // Full target equality independently proves recorded scope. Page digests are
  // deterministic checkpoint hints only, NOT substitutes for source-byte SHA.
  let offset = 0;
  let pageCount = 0;
  const checkpoints = [];
  for await (const page of targetPages) {
    if (!page || page.offset !== offset || !Array.isArray(page.targets)
      || page.targets.length === 0 || page.targets.length > maxPageSize)
      throw Error('SEAL_PAGE_SEQUENCE_INVALID');
    if (offset + page.targets.length > document.targets.length)
      throw Error('SEAL_EXTRA_TARGETS');
    for (let i = 0; i < page.targets.length; i++) {
      const observed = page.targets[i];
      const expected = document.targets[offset + i];
      if (!isDeepStrictEqual(observed, expected))
        throw Error('SEAL_FROZEN_TARGET_DIVERGENCE');
      if (i > 0 && expected.id <= document.targets[offset + i - 1].id)
        throw Error('SEAL_TARGET_ORDER_INVALID');
      if (i === 0 && offset > 0 && expected.id <= document.targets[offset - 1].id)
        throw Error('SEAL_TARGET_ORDER_INVALID');
    }
    checkpoints.push(Object.freeze({
      operationUuid: runUuid,
      manifestHash,
      offset,
      targetCount: page.targets.length,
      pageSha256: sha256(Buffer.from(JSON.stringify(document.targets.slice(offset, offset + page.targets.length)), 'utf8')),
    }));
    offset += page.targets.length;
    pageCount += 1;
  }
  if (offset !== document.targets.length) throw Error('SEAL_TARGET_COVERAGE_INCOMPLETE');
  return Object.freeze({
    operationUuid: runUuid,
    manifestHash,
    partsVerified: partNumber,
    targetsVerified: offset,
    pagesVerified: pageCount,
    stats: document.stats,
    checkpoints,
    documentBytesVerified: true,
    frozenTargetEqualityVerified: true,
    writeAuthorized: false,
    sealed: false,
  });
}
