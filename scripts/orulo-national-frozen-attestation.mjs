// Independent, READ-ONLY attestation of the original encrypted national artifact.
// This script never invokes national_control, writes a seal, grants authorization or calls CAS.
// Run only after decrypting the pinned CMS inside the protected GitHub Actions environment
// and exporting the FROZEN ledger via a PostgreSQL read-only transaction.
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { verifyFrozenNationalSeal } from './orulo-national-seal-verifier.mjs';
import { loadNationalManifest } from './orulo-media-recovery-national.mjs';

const RUN = '1c8ec62a-9c38-41ac-8091-f1ceef98ca91';
const MANIFEST_HASH = 'ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288';
const HEAD_HASH = 'a178ff82fab2e666e2ac56e8c6f64483dca0256afcbadcaa36aa17868c3f5df6';
const sha = data => createHash('sha256').update(data).digest('hex');

export async function attestOriginalNationalArtifact({ originalBytes, ledgerRows }) {
  if (!Buffer.isBuffer(originalBytes) || !ledgerRows || typeof ledgerRows[Symbol.asyncIterator] !== 'function')
    throw Error('ATTEST_INPUT_REQUIRED');
  if (sha(originalBytes) !== MANIFEST_HASH)
    throw Error('ATTEST_MANIFEST_HASH_MISMATCH');
  // This is the ORIGINAL strict validator: provenance, columns, image signatures
  // and all historical counts, not simply JSON.parse.
  const document = loadNationalManifest(originalBytes, MANIFEST_HASH);
  if (document.operationUuid !== RUN || document.targets.length !== 5684 ||
      document.stats.eligibleOccurrences !== 42893)
    throw Error('ATTEST_FROZEN_SCOPE_INVALID');

  const fragments = [];
  const frozenTargets = [];
  let nextSequence = 1;
  for await (const row of ledgerRows) {
    if (!row || row.sequence !== nextSequence ||
        typeof row.kind !== 'string' || !row.event ||
        typeof row.hash !== 'string')
      throw Error('ATTEST_LEDGER_SEQUENCE_OR_SHAPE_INVALID');
    if (nextSequence === 1) {
      if (row.kind !== 'START' || row.event.manifestHash !== MANIFEST_HASH ||
          row.event.mode !== 'national-v2-once' ||
          row.event.githubRunId !== '43003536521')
        throw Error('ATTEST_START_IDENTITY_MISMATCH');
    } else if (nextSequence <= 556) {
      if (row.kind !== 'NATIONAL_MANIFEST_PART' ||
          row.event.part !== nextSequence - 2 ||
          typeof row.event.text !== 'string')
        throw Error('ATTEST_FRAGMENT_IDENTITY_MISMATCH');
      fragments.push({part: row.event.part, text: row.event.text});
    } else {
      if (nextSequence > 6240 || row.kind !== 'NATIONAL_TARGET' ||
          !row.event.target || typeof row.event.target.id !== 'string')
        throw Error('ATTEST_FROZEN_EVENT_DIVERGENCE');
      frozenTargets.push(row.event.target);
    }
    if (nextSequence === 6240 && row.hash !== HEAD_HASH)
      throw Error('ATTEST_FROZEN_HEAD_HASH_MISMATCH');
    nextSequence++;
  }
  if (nextSequence !== 6241 || fragments.length !== 555 ||
      frozenTargets.length !== 5684)
    throw Error('ATTEST_FROZEN_LEDGER_INCOMPLETE');
  frozenTargets.sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const targetPages = [];
  for (let offset = 0; offset < frozenTargets.length; offset += 50)
    targetPages.push({offset,targets:frozenTargets.slice(offset,offset+50)});
  const result = await verifyFrozenNationalSeal({
    bytes: originalBytes,
    manifestHash: MANIFEST_HASH,
    runUuid: RUN,
    fragments,
    targetPages,
    parseAndValidateManifest: loadNationalManifest
  });
  if (!result.documentBytesVerified || !result.frozenTargetEqualityVerified ||
      result.targetsVerified !== 5684 || result.partsVerified !== 555 ||
      result.pagesVerified !== 114)
    throw Error('ATTEST_VERIFICATION_INCOMPLETE');
  // Keep attestation in stdout small, no image URLs or personal data.
  return Object.freeze({
    status:'FROZEN_MANIFEST_ATTESTED_READ_ONLY',
    runUuid:RUN,
    originalSha256:MANIFEST_HASH,
    headSequence:6240,
    headHash:HEAD_HASH,
    partsVerified:result.partsVerified,
    targetsVerified:result.targetsVerified,
    pagesVerified:result.pagesVerified,
    eligibleOccurrences:document.stats.eligibleOccurrences,
    sealed:false,
    writeAuthorized:false,
    productionWrites:0
  });
}

export async function* readFrozenLedgerLines(fileName) {
  for await (const line of createInterface({
    input:createReadStream(fileName,{encoding:'utf8'}),crlfDelay:Infinity
  })) {
    if (!line) continue;
    let row;
    try {row=JSON.parse(line);}
    catch {throw Error('ATTEST_LEDGER_JSON_INVALID');}
    yield row;
  }
}
const invoked = process.argv[1] && new URL('file://' + process.argv[1]).href === import.meta.url;
if (invoked) {
  try {
    if (process.argv.length !== 4) throw Error('ATTEST_FILES_REQUIRED');
    const out = await attestOriginalNationalArtifact({
      originalBytes:readFileSync(process.argv[2]),
      ledgerRows:readFrozenLedgerLines(process.argv[3])
    });
    console.log(JSON.stringify(out));
  } catch (error) {
    // Do not log source or ledger content.
    console.error(JSON.stringify({status:'FROZEN_MANIFEST_ATTESTATION_FAILED',
      code: /^ATTEST_[A-Z_]+$/.test(error.message)?error.message:'ATTEST_ERROR'}));
    process.exitCode = 1;
  }
}
