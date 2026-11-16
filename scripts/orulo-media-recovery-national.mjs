import { readFileSync, appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  digest,
  openPostgresJournal,
  postgresTransport,
  PROJECT_URL,
  rpcFailureDetails,
} from "./orulo-media-recovery-postgres.mjs";
import {
  validateDispatch,
  checkGitHub,
} from "./orulo-media-recovery-actions.mjs";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const image =
  /^https:\/\/static\.orulo\.com\.br\/images\/properties\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i;
export function validateNationalDispatch(env) {
  validateDispatch(env);
  if (
    ((env.ORULO_NATIONAL_ACTION || "execute") !== "reconcile" &&
      env.ORULO_NATIONAL_READY !== "true") ||
    env.ORULO_NATIONAL_APPROVED_SHA !== env.GITHUB_WORKFLOW_SHA ||
    !/^[a-f0-9]{40}$/.test(env.ORULO_NATIONAL_APPROVED_SHA || "") ||
    !hash.test(env.ORULO_NATIONAL_MANIFEST_SHA || "")
  )
    throw Error("NATIONAL_REVIEWED_CODE_AND_MANIFEST_REQUIRED");
  if (
    !/^(execute|continue|reconcile|pilot-30701|lot-(10|[1-9]))$/.test(
      env.ORULO_NATIONAL_ACTION || "execute",
    )
  )
    throw Error("NATIONAL_ACTION_INVALID");
}
export function loadNationalManifest(bytes, expected) {
  if (!hash.test(expected || "") || digest(bytes) !== expected)
    throw Error("NATIONAL_MANIFEST_HASH_MISMATCH");
  const document = JSON.parse(bytes.toString("utf8"));
  if (
    document.id !== "national-v2-once" ||
    !uuid.test(document.operationUuid) ||
    !Array.isArray(document.targets) ||
    !document.targets.length ||
    document.sourceManifestSha256 !==
      "6f6248375b5d5459496465d1c202e38e10adfade30bdef2442a7d59f00f313cc" ||
    document.reconciliationSha256 !==
      "2a9e409d6db81e4d70a6ddaee942eedb9887f4302347e333dec4c122cab8e66e"
  )
    throw Error("NATIONAL_MANIFEST_INVALID");
  let previous = "";
  let occurrences = 0;
  const urls = new Set(),
    buildings = new Set();
  for (const target of document.targets) {
    if (
      !uuid.test(target.id) ||
      target.id <= previous ||
      !/^[0-9]+$/.test(target.buildingId) ||
      !hash.test(target.baselineSha256) ||
      !Array.isArray(target.patches) ||
      !target.patches.length
    )
      throw Error("NATIONAL_TARGET_INVALID");
    previous = target.id;
    buildings.add(target.buildingId);
    const ids = new Set();
    for (const patch of target.patches) {
      if (
        !/^[0-9]+$/.test(patch.id) ||
        ids.has(patch.id) ||
        !hash.test(patch.sourceResultSha256 || "") ||
        !Number.isInteger(patch.sourceChunk) ||
        patch.sourceChunk < 0 ||
        patch.sourceChunk > 5 ||
        patch.validation !== "SOURCE_IMAGE_VALID" ||
        !Array.isArray(patch.images) ||
        !patch.images.length ||
        !Array.isArray(patch.checks)
      )
        throw Error("NATIONAL_PLAN_ID_INVALID");
      ids.add(patch.id);
      occurrences++;
      for (const url of patch.images) {
        const checks = patch.checks.filter((c) => c.url === url);
        if (
          !image.test(url) ||
          checks.length !== 1 ||
          checks[0].evidence?.url !== url ||
          checks[0].evidence?.status !== "VALIDATED_PREFIX" ||
          !hash.test(checks[0].evidenceSha256) ||
          !hash.test(checks[0].evidence.prefixSha256)
        )
          throw Error("NATIONAL_PROVENANCE_INVALID");
        urls.add(url);
      }
    }
  }
  if (
    document.stats.properties !== document.targets.length ||
    document.stats.eligibleOccurrences !== occurrences ||
    document.stats.distinctUrls !== urls.size ||
    document.stats.buildings !== buildings.size
  )
    throw Error("NATIONAL_COUNTS_DIVERGENCE");
  return document;
}
export function nationalPlans(row, target) {
  const plans = row.raw_data?.building?.floor_plans;
  if (
    row.id !== target.id ||
    row.source !== "novos" ||
    !row.external_id?.startsWith("orulo:" + target.buildingId + ":") ||
    row.raw_data?.building_id !== target.buildingId ||
    (row.raw_data.building?.id != null &&
      String(row.raw_data.building.id) !== target.buildingId) ||
    !Array.isArray(plans) ||
    new Set(plans.map((p) => String(p?.id))).size !== plans.length ||
    plans.some((p) => p?.id == null)
  )
    throw Error("NATIONAL_IDENTITY_CONFLICT");
  const patches = new Map(target.patches.map((p) => [p.id, p]));
  if ([...patches.keys()].some((id) => !plans.some((p) => String(p.id) === id)))
    throw Error("NATIONAL_PLAN_MISSING");
  return plans.map((plan) => {
    const patch = patches.get(String(plan.id));
    if (!patch) return plan;
    if (
      (plan.images != null &&
        (!Array.isArray(plan.images) || plan.images.length)) ||
      ["image_url", "url", "2280x1800", "1024x1024", "520x280"].some(
        (k) => plan[k] != null && plan[k] !== "",
      )
    )
      throw Error("NATIONAL_EXISTING_IMAGE");
    return { ...plan, images: [...patch.images] };
  });
}
export function nationalApprovalSql({
  runUuid,
  headHash,
  githubRunId,
  controlSha,
  continuation = false,
}) {
  if (
    !uuid.test(runUuid) ||
    !hash.test(headHash) ||
    !/^[1-9][0-9]*$/.test(githubRunId) ||
    !/^[a-f0-9]{40}$/.test(controlSha)
  )
    throw Error("NATIONAL_APPROVAL_INVALID");
  return `begin;\nset local lock_timeout='5s';\nselect orulo_audit.${continuation ? "authorize_national_continuation" : "authorize_pilot"}('${runUuid}'::uuid,'${headHash}','${githubRunId}','${controlSha}','Owner explicitly approves ${continuation ? "continuation of the same frozen national operation after previous runner termination and reconciliation" : "only this complete frozen national-v2-once manifest and exact code revision"}');\ncommit;`;
}
export function verifyNationalImages(checks) {
  if (!checks.length) return;
  const result = spawnSync(
    "python3",
    [new URL("./orulo-v2-verify-images.py", import.meta.url).pathname],
    {
      input: JSON.stringify(checks),
      encoding: "utf8",
      timeout: 300000,
      maxBuffer: 65536,
    },
  );
  if (result.status !== 0) throw Error("NATIONAL_SOURCE_IMAGE_UNAVAILABLE");
  let body;
  try {
    body = JSON.parse(result.stdout);
  } catch {
    throw Error("NATIONAL_SOURCE_IMAGE_UNAVAILABLE");
  }
  if (body.valid !== true || body.checked !== checks.length)
    throw Error("NATIONAL_SOURCE_IMAGE_UNAVAILABLE");
}
export async function executeNational({
  env,
  bytes,
  transport,
  verifyImages = verifyNationalImages,
  onPlan = () => {},
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
}) {
  validateNationalDispatch(env);
  const manifest = loadNationalManifest(bytes, env.ORULO_NATIONAL_MANIFEST_SHA);
  const run = manifest.operationUuid,
    action = env.ORULO_NATIONAL_ACTION || "execute";
  if (
    (action === "continue" && !uuid.test(env.ORULO_NATIONAL_RUN_UUID || "")) ||
    (env.ORULO_NATIONAL_RUN_UUID && env.ORULO_NATIONAL_RUN_UUID !== run)
  )
    throw Error("NATIONAL_OPERATION_UUID_DIVERGENCE");
  if (action === "reconcile")
    return {
      operationUuid: run,
      result: await transport.control("national_report", { p_run: run }),
    };
  const frozenRun = "1c8ec62a-9c38-41ac-8091-f1ceef98ca91";
  const pilotId = "000a4d50-a014-4270-bb89-26adb841f142";
  const scoped = action.startsWith("lot-") || action === "pilot-30701";
  if (run === frozenRun && !scoped) throw Error("NATIONAL_SCOPED_MODE_REQUIRED");
  const representative = action === "pilot-30701" ? pilotId : env.ORULO_SCOPE_TARGET;
  let scope;
  if (scoped) {
    if (run !== frozenRun || !uuid.test(representative || "") ||
        !uuid.test(env.ORULO_SCOPE_AUTHORIZATION_ID || "") || !hash.test(env.ORULO_SCOPE_PLAN_SHA || ""))
      throw Error("NATIONAL_SCOPE_CONFIGURATION_INVALID");
    scope = {id: representative, scope: {
      authorizationId: env.ORULO_SCOPE_AUTHORIZATION_ID,
      lot: action === "pilot-30701" ? 1 : Number(action.slice(4)),
      githubRunId: env.GITHUB_RUN_ID,
      controlSha: env.GITHUB_WORKFLOW_SHA,
      planSha256: env.ORULO_SCOPE_PLAN_SHA,
    }};
  }
  if (action === "continue") {
    const state = await transport.control("national_report", { p_run: run });
    await onPlan({
      runUuid: run,
      headHash: state.head.hash,
      githubRunId: env.GITHUB_RUN_ID,
      controlSha: env.GITHUB_WORKFLOW_SHA,
      continuation: true,
      stats: manifest.stats,
    });
    const deadline = now() + 600000;
    while (
      !(await transport.control("national_continue_status", {
        p_run: run,
        p_event: { githubRunId: env.GITHUB_RUN_ID },
      }))
    ) {
      if (now() >= deadline)
        return {
          operationUuid: run,
          status: "CONTINUATION_AUTHORIZATION_PENDING",
        };
      await wait(5000);
    }
  }
  const journal = await openPostgresJournal(env, transport, {
    national: true,
    runUuid: run,
    manifestHash: env.ORULO_NATIONAL_MANIFEST_SHA,
    resume: action === "continue",
    scope,
  });
  if (action === "execute") {
    const text = bytes.toString("utf8");
    // Wire fragments are transport pages, not separate operations or authorizations.
    for (
      let offset = 0, part = 0;
      offset < text.length;
      offset += 131072, part++
    )
      await journal.checkpoint("national_part", {
        part,
        text: text.slice(offset, offset + 131072),
      });
    for (const target of manifest.targets)
      await journal.checkpoint("national_target", { target });
    const seal = await journal.checkpoint("national_seal", {});
    await onPlan({
      runUuid: run,
      headHash: seal.ack.hash,
      githubRunId: env.GITHUB_RUN_ID,
      controlSha: env.GITHUB_WORKFLOW_SHA,
      stats: manifest.stats,
    });
    const deadline = now() + 600000;
    while (!(await journal.adoptNationalAuthorization())) {
      if (now() >= deadline)
        return {
          operationUuid: run,
          status: "ADMIN_AUTHORIZATION_PENDING",
          manifestHash: env.ORULO_NATIONAL_MANIFEST_SHA,
        };
      await wait(5000);
    }
  }
  const started = now(),
    budget = 14400 * 1000,
    checked = new Map();
  let confirmed = 0;
  const selected = scoped ? new Set(journal.scopedTargets()) : null;
  if (scoped && (selected.size !== journal.scopedTargets().length ||
      !selected.has(representative) || (action === "pilot-30701" &&
        (selected.size !== 1 || !selected.has(pilotId)))))
    throw Error("NATIONAL_SCOPE_TARGETS_DIVERGENCE");
  const executionOrder = manifest.targets.filter(t => !selected || selected.has(t.id)).sort(
    (a, b) =>
      a.buildingId.localeCompare(b.buildingId) || a.id.localeCompare(b.id),
  );
  if (scoped && executionOrder.length !== selected.size) throw Error("NATIONAL_SCOPE_TARGETS_DIVERGENCE");
  if (action === "pilot-30701" && (executionOrder[0]?.buildingId !== "30701" ||
      executionOrder[0]?.patches.length !== 4 ||
      executionOrder[0]?.baselineSha256 !== "ca042e5572ce2421400b4f95e572b4802bf1966f837395103776521963e7e4d6"))
    throw Error("NATIONAL_PILOT_FROZEN_TARGET_MISMATCH");
  await journal.nationalSnapshot("BASELINE_V2");
  for (const target of executionOrder) {
    if (now() - started > budget) {
      await journal.record({
        type: "CLIENT_STOP",
        stage: "NATIONAL_CHECKPOINT",
        reason: "TIME_BUDGET",
        confirmedThisSession: confirmed,
      });
      return {
        operationUuid: run,
        status: "CONTINUATION_REQUIRED",
        head: journal.head(),
        confirmedThisSession: confirmed,
      };
    }
    const pre = await transport.control("national_row", {
      p_run: run,
      p_event: { id: target.id },
    });
    if (pre.result) {
      if (
        pre.result.result?.status !== "UPDATED" ||
        pre.sha256 !== pre.result.result.receipt?.afterSha256
      )
        throw Error("NATIONAL_COMMITTED_ROW_DIVERGENCE");
      // Never send another CAS for an already committed receipt, even if the old
      // runner died before writing its client readback entry.
      if (!pre.readback)
        await journal.record({
          type: "CLIENT_READBACK",
          stage: "NATIONAL_ROW_VERIFIED",
          id: target.id,
          operationId: pre.result.operationId,
          sha256: pre.sha256,
        });
      continue;
    }
    if (pre.sha256 !== target.baselineSha256) {
      if (scoped && action !== "pilot-30701") continue; // Classified from locked evidence at scope finish.
      throw Error("NATIONAL_FROZEN_BASELINE_CHANGED");
    }
    if (action === "pilot-30701" && pre.row?.external_id !== "orulo:30701:49924")
      throw Error("NATIONAL_PILOT_FROZEN_TARGET_MISMATCH");
    const desired = nationalPlans(pre.row, target),
      checks = target.patches
        .flatMap((p) => p.checks)
        .filter(
          (c) => !checked.has(c.url) || now() - checked.get(c.url) > 300000,
        );
    await verifyImages(checks);
    for (const check of checks) checked.set(check.url, now());
    const operationId = randomUUID();
    await journal.record({
      type: "INTENT",
      id: target.id,
      operationId,
      expected: pre.row,
      desiredPlans: desired,
      ...(scoped ? {scope:scope.scope} : {}),
    });
    const result = await journal.apply(operationId);
    if (result.status !== "UPDATED" || result.receipt?.verified !== true)
      throw Error("NATIONAL_CAS_NOT_UPDATED");
    confirmed++;
    const post = await transport.control("national_row", {
      p_run: run,
      p_event: { id: target.id },
    });
    const expected = {
      ...pre.row,
      raw_data: {
        ...pre.row.raw_data,
        building: { ...pre.row.raw_data.building, floor_plans: desired },
      },
    };
    if (
      !isDeepStrictEqual(post.row, expected) ||
      post.sha256 !== result.receipt.afterSha256 ||
      result.receipt.beforeSha256 !== target.baselineSha256
    )
      throw Error("NATIONAL_READBACK_DIVERGENCE");
    await journal.record({
      type: "CLIENT_READBACK",
      stage: "NATIONAL_ROW_VERIFIED",
      id: target.id,
      operationId,
      sha256: post.sha256,
    });
  }
  await journal.nationalSnapshot("READBACK_V2");
  const finish = await journal.checkpoint(scoped ? "national_scope_finish" : "national_finish", scope || {});
  return {
    operationUuid: run,
    status: finish.entry.event.type,
    rowsWritten: finish.entry.event.rowsWritten ?? finish.entry.event.counts?.UPDATED ?? 0,
    counts: finish.entry.event.counts,
    manifestHash: env.ORULO_NATIONAL_MANIFEST_SHA,
    head: finish.ack,
  };
}
export async function nationalMain(command, env = process.env) {
  validateNationalDispatch(env);
  if (command === "github-gate") {
    await checkGitHub(env);
    console.log("National manual owner/main/environment gate verified.");
    return;
  }
  if (command !== "batch") throw Error("NATIONAL_COMMAND_INVALID");
  const bytes = readFileSync(env.ORULO_NATIONAL_MANIFEST_PATH);
  const operationUuid = loadNationalManifest(
    bytes,
    env.ORULO_NATIONAL_MANIFEST_SHA,
  ).operationUuid;
  try {
    console.log(
      JSON.stringify(
        await executeNational({
          env,
          bytes,
          transport: postgresTransport({
            url: PROJECT_URL,
            key: env.SUPABASE_SECRET_KEY,
          }),
          onPlan: (p) => {
            const view =
              JSON.stringify({
                operationUuid: p.runUuid,
                manifestHash: env.ORULO_NATIONAL_MANIFEST_SHA,
                stats: p.stats,
                authorizationPending: true,
              }) +
              "\n" +
              nationalApprovalSql(p);
            console.log(view);
            if (env.GITHUB_STEP_SUMMARY)
              appendFileSync(
                env.GITHUB_STEP_SUMMARY,
                "```text\n" + view + "\n```\n",
              );
          },
        }),
      ),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        operationUuid,
        code: /^NATIONAL_[A-Z_]+$/.test(error.message)
          ? error.message
          : "NATIONAL_HALTED_RECONCILIATION_REQUIRED",
        ...rpcFailureDetails(error),
      }),
    );
    process.exitCode = 1;
  }
}
