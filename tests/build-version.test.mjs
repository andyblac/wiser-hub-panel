import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import buildVersion from "../scripts/build-version.mjs";

test("development builds advance without changing package metadata until complete", () => {
  const root = mkdtempSync(join(tmpdir(), "wiser-hub-panel-version-"));
  const output = join(root, "dist");
  mkdirSync(output);
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({version:"1.2.3"}));
    const pending = buildVersion({dev:true, root});
    assert.equal(pending.version, "1.2.4-beta.1-dev.1");
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, "1.2.3");
    pending.complete(output);
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, pending.version);
    assert.deepEqual(JSON.parse(readFileSync(join(output, "build-info.json"), "utf8")), {
      version:pending.version,
      resourceUrl:`/wiser/wiser-hub-panel.js?v=${pending.version}`,
    });
  } finally {
    rmSync(root, {recursive:true, force:true});
  }
});

test("release tags must match the semantic build version", () => {
  const root = mkdtempSync(join(tmpdir(), "wiser-hub-panel-release-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({version:"1.2.3"}));
    assert.equal(buildVersion({root, releaseTag:"v1.2.3"}).version, "1.2.3");
    assert.throws(() => buildVersion({root, releaseTag:"v1.2.4"}), /does not match/);
  } finally {
    rmSync(root, {recursive:true, force:true});
  }
});
