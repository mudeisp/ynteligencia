const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "api/build-info.js"), "utf8");
const loaded = import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

const fixture = {
  VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_ENV: "production",
  VERCEL_DEPLOYMENT_ID: "dpl_example",
  VERCEL_URL: "example.vercel.app",
  VERCEL_PROJECT_ID: "prj_example",
  VERCEL_GIT_REPO_OWNER: "mudeisp",
  VERCEL_GIT_REPO_SLUG: "ynteligencia"
};

function response() {
  return {
    headers: {}, code: null, body: undefined, ended: false,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; }
  };
}

test("reports the deployment identity supplied by Vercel", async () => {
  const {buildInfo} = await loaded;
  assert.deepEqual(buildInfo(fixture), {
    schemaVersion: 1, gitSha: fixture.VERCEL_GIT_COMMIT_SHA, branch: "main",
    environment: "production", deploymentId: "dpl_example",
    deploymentUrl: "example.vercel.app", projectId: "prj_example",
    repository: "mudeisp/ynteligencia"
  });
});

test("preview and custom targets are never labeled production", async () => {
  const {buildInfo} = await loaded;
  assert.equal(buildInfo({...fixture, VERCEL_ENV:"preview"}).environment, "preview");
  assert.equal(buildInfo({...fixture, VERCEL_TARGET_ENV:"staging"}).environment, "staging");
});

test("missing metadata stays null instead of inventing a production identity or timestamp", async () => {
  const {buildInfo} = await loaded;
  assert.deepEqual(buildInfo({}), {
    schemaVersion:1, gitSha:null, branch:null, environment:null,
    deploymentId:null, deploymentUrl:null, projectId:null, repository:null
  });
  assert.equal(buildInfo({VERCEL_ENV:"  "}).environment, null);
  assert.equal(buildInfo({VERCEL_GIT_REPO_OWNER:"mudeisp"}).repository, null);
});

test("allowlist excludes secrets and personal metadata without mutating env", async () => {
  const {buildInfo} = await loaded;
  const env = Object.freeze({...fixture, VERCEL_TOKEN:"secret", SUPABASE_SERVICE_ROLE_KEY:"secret",
    VERCEL_GIT_COMMIT_AUTHOR_NAME:"Personal Name", EMAIL:"private@example.test"});
  assert.deepEqual(buildInfo(env), buildInfo(fixture));
});

test("GET returns live environment metadata and disables browser and CDN caching", async () => {
  const {default:handler, buildInfo} = await loaded;
  const res = response();
  handler({method:"GET", query:{gitSha:"spoofed"}, headers:{cookie:"private"}}, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, buildInfo(process.env));
  assert.match(res.headers["Content-Type"], /application\/json/);
  for (const key of ["Cache-Control","CDN-Cache-Control","Vercel-CDN-Cache-Control"]) {
    assert.match(res.headers[key], /no-store/);
  }
  assert.equal(JSON.stringify(res.body).includes("spoofed"), false);
});

test("HEAD has no body and unsupported methods are read-only failures", async () => {
  const {default:handler} = await loaded;
  const head = response();
  handler({method:"HEAD"}, head);
  assert.equal(head.code, 200);
  assert.equal(head.ended, true);
  assert.equal(head.body, undefined);
  for (const method of ["POST","PUT","DELETE","OPTIONS"]) {
    const res = response();
    handler({method}, res);
    assert.equal(res.code, 405);
    assert.equal(res.headers.Allow, "GET, HEAD");
    assert.deepEqual(res.body, {error:"Method not allowed"});
  }
});
