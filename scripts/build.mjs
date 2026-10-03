import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import buildVersion from "./build-version.mjs";

const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("src/wiser-hub-panel.js", root), "utf8");
const translationNames = ["en-US", "en-GB", "fr", "de"];
const translations = Object.fromEntries(translationNames.map(language => [
  language,
  JSON.parse(readFileSync(new URL(`src/localize/languages/${language}.json`, root), "utf8")),
]));
const referenceKeys = Object.keys(translations["en-US"]).sort();
for (const [language, strings] of Object.entries(translations)) {
  const keys = Object.keys(strings).sort();
  if (JSON.stringify(keys) !== JSON.stringify(referenceKeys)) {
    throw new Error(`${language} translations do not match en-US keys`);
  }
}
const dev = process.argv.includes("--dev");
const final = process.argv.includes("--release");
const preserve = process.argv.includes("--test");
if ([dev, final, preserve].filter(Boolean).length > 1) {
  throw new Error("A build cannot use more than one version mode");
}
const build = buildVersion({
  dev,
  final,
  preserve,
  root:fileURLToPath(root),
  releaseTag:process.env.RELEASE_TAG,
});
const token = "__WISER_HUB_PANEL_VERSION__";
if (!source.includes(token)) throw new Error(`Missing ${token} source token`);
const translationToken = "__WISER_HUB_TRANSLATIONS__";
if (!source.includes(translationToken)) throw new Error(`Missing ${translationToken} source token`);
const output = new URL("dist/", root);
mkdirSync(output, {recursive:true});
const bundleSource = source
  .replaceAll(token, build.version)
  .replaceAll(translationToken, JSON.stringify(translations, null, 2));
const bundle = `/*! WISER-CARD-VERSION wiser-hub-panel ${build.version} */\n${bundleSource}`;
writeFileSync(new URL("wiser-hub-panel.js", output), bundle);
build.complete(fileURLToPath(output));
console.log(`Built wiser-hub-panel ${build.version}`);
console.log(`Panel resource: ${build.resourceUrl}`);
