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

  const receipts = await stageCheckpointPages({
    checkpoints: verified.checkpoints, document: {...document, manifestSha256: originalManifestHash}, checkpointPage, onCheckpoint,
    expectedTargetCount: 5684
  });

  return Object.freeze({
    runUuid, originalManifestHash, partsVerified: verified.partsVerified,
    targetsVerified: verified.targetsVerified, pagesVerified: receipts.length,
    receipts, sealed: false, writeAuthorized: false
  });
}

/**
 * Pure checkpoint transport. Check complete proof, no gaps and exact per-page
 * SHA BEFORE the first RPC. Exported for deterministic unit tests.
 * The SQL independently rereads and compares frozen targets.
 */
export async function stageCheckpointPages({
  checkpoints, document, checkpointPage, expectedTargetCount = 5684, onCheckpoint
}) {
  if (!Array.isArray(checkpoints) || !Array.isArray(document?.targets) ||
      document.targets.length !== expectedTargetCount || typeof checkpointPage !== 'function')
    throw Error('CHECKPOINT_PLAN_INVALID');
  let next = 0;
  for (const page of checkpoints) {
    if (!Number.isInteger(page.offset) || !Number.isInteger(page.targetCount) ||
        page.offset !== next || page.targetCount < 1 || page.targetCount > 50)
      throw Error('CHECKPOINT_PLAN_GAP_OR_OVERLAP');
    const targets = document.targets.slice(page.offset, page.offset + page.targetCount);
    if (targets.length !== page.targetCount ||
        digest(Buffer.from(JSON.stringify(targets))) !== page.pageSha256)
      throw Error('CHECKPOINT_PLAN_HASH_DIVERGED');
    next += page.targetCount;
  }
  if (next !== expectedTargetCount) throw Error('CHECKPOINT_PLAN_INCOMPLETE');

  const receipts = [];
  for (const page of checkpoints) {
    const targets = document.targets.slice(page.offset, page.offset + page.targetCount);
    const result = await checkpointPage({
      p_run: document.operationUuid,
      p_manifest_sha256: document.manifestSha256,
      p_offset: page.offset,
      p_expected_targets: targets
    });
    if (!result || !['VERIFIED', 'ALREADY_VERIFIED'].includes(result.status) ||
        result.pageOffset !== page.offset ||
        result.nextOffset < page.offset + targets.length)
      throw Error('CHECKPOINT_RPC_RECEIPT_INVALID');
    const receipt = {offset: page.offset, count: targets.length, status: result.status};
    receipts.push(receipt);
    onCheckpoint?.(receipt);
  }
  return receipts;
}
