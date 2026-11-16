import { createHash } from 'node:crypto';
import { verifyFrozenNationalSeal } from './orulo-national-seal-verifier.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const RUN = '1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
const HASH = 'ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288';

/**
 * Stage checkpoints only after full, independent integrity verification.
 * Callbacks supplied by a privileged, authenticated runner MUST read the frozen
 * ledger rather than accepting external assertions, and MUST pin the historical
 * artifact bytes. The SQL checkpoint RPC independently compares each page.
 *
 * This function cannot seal, authorize writes or call CAS. NOT A PROD RUNNER.
 */
export async function stageVerifiedNationalCheckpoints({
  originalBytes, originalManifestHash = HASH, runUuid = RUN,
  fragments, targetPages, parseAndValidateManifest, checkpointPage, onCheckpoint
}) {
  if (!Buffer.isBuffer(originalBytes)) throw Error('CHECKPOINT_SOURCE_BYTES_REQUIRED');
  if (runUuid !== RUN || originalManifestHash !== HASH)
    throw Error('CHECKPOINT_HISTORICAL_IDENTITY_REQUIRED');
  if (digest(originalBytes) !== HASH) throw Error('CHECKPOINT_ORIGINAL_ARTIFACT_HASH_MISMATCH');
  if (typeof parseAndValidateManifest !== 'function' || typeof checkpointPage !== 'function')
    throw Error('CHECKPOINT_TRUSTED_CALLBACK_REQUIRED');

  // The validator must enforce provenance, schema, columns, image evidence, and
  // frozen stats. A JSON.parse-only callback is NOT sufficient for production.
  const verified = await verifyFrozenNationalSeal({
    bytes: originalBytes, manifestHash: originalManifestHash, runUuid,
    fragments, targetPages, parseAndValidateManifest
  });
  if (!verified.documentBytesVerified || !verified.frozenTargetEqualityVerified ||
      verified.targetsVerified !== 5684 || verified.partsVerified !== 555)
    throw Error('CHECKPOINT_FROZEN_PROOF_INCOMPLETE');

  const document = parseAndValidateManifest(originalBytes, originalManifestHash);
  if (document.operationUuid !== RUN || document.targets.length !== 5684)
    throw Error('CHECKPOINT_POST_VERIFY_DOCUMENT_DIVERGED');

  const receipts = [];
  for (const checkpoint of verified.checkpoints) {
    const targets = document.targets.slice(checkpoint.offset, checkpoint.offset + checkpoint.targetCount);
    const result = await checkpointPage({
      p_run: runUuid,
      p_manifest_sha256: originalManifestHash,
      p_offset: checkpoint.offset,
      p_expected_targets: targets
    });
    if (!result || !['VERIFIED', 'ALREADY_VERIFIED'].includes(result.status) ||
        result.pageOffset !== checkpoint.offset ||
        (result.status === 'VERIFIED' && result.nextOffset !== checkpoint.offset + targets.length))
      throw Error('CHECKPOINT_RPC_RECEIPT_INVALID');
    receipts.push({offset: checkpoint.offset, count: targets.length, status: result.status});
    onCheckpoint?.(receipts.at(-1));
  }
  if (receipts.reduce((s, x) => s + x.count, 0) !== 5684)
    throw Error('CHECKPOINT_RECEIPTS_INCOMPLETE');

  return Object.freeze({
    runUuid, originalManifestHash, partsVerified: verified.partsVerified,
    targetsVerified: verified.targetsVerified, pagesVerified: receipts.length,
    receipts, sealed: false, writeAuthorized: false
  });
}
