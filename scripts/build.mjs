import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(ROOT, "dist");
const DEFAULT_SECTION_TITLES = new Set(["今日読んだところ", "英文を考える", "今日の単語・言い回し", "感じたこと"]);

const site = await readJson(path.join(ROOT, "site.config.json"));
validateSiteConfig(site);

const templates = Object.fromEntries(
  await Promise.all(
    ["base", "home", "work", "record", "guide"].map(async (name) => [
      name,
      await readFile(path.join(ROOT, "src", "templates", `${name}.html`), "utf8"),
    ]),
  ),
);

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
});

markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const src = token.attrGet("src") ?? "";
  const title = token.attrGet("title");
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a class="record-image-link" href="${escapeHtml(src)}" data-image-viewer><img src="${escapeHtml(src)}" alt="${escapeHtml(token.content)}" loading="lazy" decoding="async"${titleAttribute}></a>`;
};

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, environment, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  const href = token.attrGet("href") ?? "";
  if (/^https?:\/\//i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkOpen(tokens, index, options, environment, self);
};

const works = await loadWorks();
const preparedDirectories = await ensureWorkDirectories(works);
if (preparedDirectories.length > 0) {
  console.log(`Prepared work directories: ${preparedDirectories.join(", ")}`);
}

await rm(OUTPUT_DIR, { recursive: true, force: true });
await mkdir(OUTPUT_DIR, { recursive: true });
await cp(path.join(ROOT, "src", "assets"), path.join(OUTPUT_DIR, "assets"), { recursive: true });
await writeFile(path.join(OUTPUT_DIR, ".nojekyll"), "", "utf8");
await cp(
  path.join(ROOT, "google296662f7c3e82eca.html"),
  path.join(OUTPUT_DIR, "google296662f7c3e82eca.html"),
);

const records = await loadRecords(works);
const publishedWorks = works.filter((work) => work.published !== false);
const publishedWorkIds = new Set(publishedWorks.map((work) => work.id));
const publishedRecords = records.filter((record) => publishedWorkIds.has(record.workId));
const pages = [];

if (publishedWorks.length === 0) {
  throw new Error("公開対象の作品がありません。work.json の published を確認してください。");
}

for (const work of works) {
  work.records = records
    .filter((record) => record.workId === work.id)
    .sort((a, b) => Number(b.number) - Number(a.number));
  work.recordCount = work.records.length;
  work.lastUpdated = newestDate(work.records.map((record) => record.updatedAt));
}

await buildHome();
for (const work of publishedWorks) {
  await buildWorkPage(work);
  await buildGuidePage(work);
  await buildRecordPages(work);
}
await buildSitemap();
await buildRobots();
await validateGeneratedLinks();

const recordLabel = publishedRecords.length === 1 ? "record" : "records";
console.log(`Built ${pages.length} HTML pages and ${publishedRecords.length} ${recordLabel} in dist/.`);

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${path.relative(ROOT, filePath)} を読み込めません: ${error.message}`);
  }
}

function validateSiteConfig(config) {
  for (const key of ["title", "description", "siteUrl", "timezone"]) {
    if (!config[key] || typeof config[key] !== "string") {
      throw new Error(`site.config.json の ${key} が未設定です。`);
    }
  }
  if (!config.siteUrl.endsWith("/")) {
    throw new Error("site.config.json の siteUrl は / で終わるURLにしてください。");
  }
  new Intl.DateTimeFormat("ja-JP", { timeZone: config.timezone }).format(new Date());
}

async function loadWorks() {
  const worksDir = path.join(ROOT, "works");
  const entries = await readdir(worksDir, { withFileTypes: true });
  const loaded = [];
  const cardNumbers = new Set();

  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!/^[a-z0-9-]+$/.test(entry.name)) {
      throw new Error(`作品ID「${entry.name}」は半角英小文字・数字・ハイフンだけにしてください。`);
    }

    const workDir = path.join(worksDir, entry.name);
    const data = await readJson(path.join(workDir, "work.json"));
    const required = ["id", "title", "originalTitle", "author", "authorJa", "status", "cardNumber", "recordTitlePrefix", "introduction", "gutenbergUrl"];
    for (const key of required) {
      if (!data[key] || typeof data[key] !== "string") {
        throw new Error(`works/${entry.name}/work.json の ${key} が未設定です。`);
      }
    }
    if (data.id !== entry.name) {
      throw new Error(`works/${entry.name}/work.json の id は「${entry.name}」にしてください。`);
    }
    if (!["読書中", "読了"].includes(data.status)) {
      throw new Error(`作品「${data.title}」の status は「読書中」または「読了」にしてください。`);
    }
    if (!/^\d{2}$/.test(data.cardNumber)) {
      throw new Error(`作品「${data.title}」の cardNumber は2桁の数字にしてください。`);
    }
    if (cardNumbers.has(data.cardNumber)) {
      throw new Error(`作品番号「${data.cardNumber}」が重複しています。`);
    }
    cardNumbers.add(data.cardNumber);
    if (data.published !== undefined && typeof data.published !== "boolean") {
      throw new Error(`作品「${data.title}」の published は true または false にしてください。`);
    }

    const guidePath = path.join(workDir, "guide.html");
    if (!existsSync(guidePath)) {
      throw new Error(`works/${entry.name}/guide.html がありません。`);
    }

    const byline = data.byline
      ?? (data.translator ? `${data.author}　英訳：${data.translator}` : data.author);
    const guideByline = data.guideByline ?? data.authorJa;
    const guideTags = Array.isArray(data.guideTags) ? data.guideTags : [];

    loaded.push({
      ...data,
      byline,
      guideByline,
      guideTags,
      guidePath,
      metadataUpdatedAt: gitLastCommit(path.relative(ROOT, path.join(workDir, "work.json"))),
      guideUpdatedAt: gitLastCommit(path.relative(ROOT, guidePath)),
    });
  }

  if (loaded.length === 0) {
    throw new Error("works/ に作品が登録されていません。 ");
  }
  return loaded;
}

async function ensureWorkDirectories(registeredWorks) {
  const prepared = [];

  for (const work of registeredWorks) {
    const directories = [
      path.join(ROOT, "reading", work.id),
      path.join(ROOT, "src", "assets", "reading", work.id),
    ];

    for (const directoryPath of directories) {
      if (existsSync(directoryPath)) continue;

      await mkdir(directoryPath, { recursive: true });
      await writeFile(path.join(directoryPath, ".gitkeep"), "", { flag: "wx" });
      prepared.push(path.relative(ROOT, directoryPath).replaceAll(path.sep, "/"));
    }
  }

  return prepared;
}

async function loadRecords(registeredWorks) {
  const readingDir = path.join(ROOT, "reading");
  const workIds = new Set(registeredWorks.map((work) => work.id));
  const readingEntries = await readdir(readingDir, { withFileTypes: true });

  for (const entry of readingEntries.filter((item) => item.isDirectory())) {
    if (!workIds.has(entry.name)) {
      const contents = await readdir(path.join(readingDir, entry.name));
      if (contents.some((name) => !name.startsWith("."))) {
        throw new Error(`reading/${entry.name} に対応する作品情報が works/ にありません。`);
      }
    }
  }

  const loaded = [];
  for (const work of registeredWorks) {
    const workReadingDir = path.join(readingDir, work.id);
    if (!existsSync(workReadingDir)) continue;

    const entries = (await readdir(workReadingDir, { withFileTypes: true }))
      .filter((item) => !item.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (!entry.isFile() || !/^\d{3}\.md$/.test(entry.name)) {
        throw new Error(`reading/${work.id}/${entry.name} は3桁の番号を付けたMarkdownファイルではありません。`);
      }

      const number = path.basename(entry.name, ".md");
      const markdownPath = path.join(workReadingDir, entry.name);
      const source = await readFile(markdownPath, "utf8");
      if (/^---\s*$/m.test(source.split(/\r?\n/).slice(0, 2).join("\n"))) {
        throw new Error(`${path.relative(ROOT, markdownPath)} にfront matterは不要です。`);
      }

      const cleanedSource = stripEmptyDefaultSections(source);
      const updatedAt = gitLastCommit(path.relative(ROOT, markdownPath));
      if (!updatedAt && process.env.GITHUB_ACTIONS === "true") {
        throw new Error(`${path.relative(ROOT, markdownPath)} のGit commit日時を取得できません。`);
      }

      loaded.push({
        workId: work.id,
        number,
        markdownPath,
        html: renderRecordMarkdown(cleanedSource),
        updatedAt,
        title: `${work.recordTitlePrefix} ${number}`,
      });
    }
  }
  return loaded;
}

function stripEmptyDefaultSections(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^##\s+(.+?)\s*$/);
    if (!match || !DEFAULT_SECTION_TITLES.has(match[1])) {
      output.push(lines[index]);
      continue;
    }

    let nextHeading = index + 1;
    while (nextHeading < lines.length && !/^##\s+/.test(lines[nextHeading])) {
      nextHeading += 1;
    }
    const body = lines.slice(index + 1, nextHeading).join("\n").trim();
    if (body.length > 0) {
      output.push(lines[index]);
    }
  }
  return output.join("\n").trim();
}

function renderRecordMarkdown(source) {
  const sourceBlocks = [];
  const preparedSource = source.replace(
    /<details\s+class=(['"])source-text\1\s*>\s*<summary>\s*今日読む原文を開く\s*<\/summary>([\s\S]*?)<\/details>/gi,
    (match, quote, body) => {
      const index = sourceBlocks.length;
      const bodyHtml = markdown.render(body.trim());
      sourceBlocks.push(`<details class="source-text">
<summary>今日読む原文を開く</summary>
<div class="source-text__body" lang="en">${bodyHtml}</div>
</details>`);
      return `\n<!--SOURCE_TEXT_${index}-->\n`;
    },
  );

  let html = markdown.render(preparedSource);
  for (let index = 0; index < sourceBlocks.length; index += 1) {
    html = html.replace(`<!--SOURCE_TEXT_${index}-->`, sourceBlocks[index]);
  }
  return html;
}

function gitLastCommit(relativePath) {
  try {
    const result = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", relativePath.replaceAll(path.sep, "/")],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!result) return null;
    const date = new Date(result);
    if (Number.isNaN(date.valueOf())) return null;
    return date;
  } catch {
    return null;
  }
}

async function buildHome() {
  const currentWorks = publishedWorks.filter((work) => work.status === "読書中");
  const latestRecord = [...publishedRecords].sort(compareRecordsByUpdate)[0];

  const homeContent = renderTemplate(templates.home, {
    latestRecordLink: latestRecord
      ? `<p class="latest-entry"><a href="reading/${encodeURIComponent(latestRecord.workId)}/${latestRecord.number}/">最新記事はこちら<span aria-hidden="true">→</span></a></p>`
      : "",
    currentWorks: currentWorks.length > 0
      ? currentWorks.map((work) => renderWorkCard(work, { detailed: true })).join("\n")
      : '<p class="empty-state">現在読んでいる作品はありません。</p>',
    allWorks: publishedWorks.map((work) => renderWorkCard(work)).join("\n"),
    footer: renderFooter(),
  });
  const latestContentDate = newestDate([
    ...publishedRecords.map((record) => record.updatedAt),
    ...publishedWorks.map((work) => work.metadataUpdatedAt),
  ]);

  await addHtmlPage("", renderBase({
    route: "",
    pageTitle: site.title,
    description: site.description,
    bodyClass: "home-page",
    content: homeContent,
  }), latestContentDate);
}

function renderWorkCard(work, { detailed = false } = {}) {
  const details = detailed
    ? `${work.collection ? `<p class="work-card__collection"><span>収録</span>${escapeHtml(work.collection)}</p>` : ""}<p class="work-card__introduction">${escapeHtml(work.introduction)}</p>`
    : "";
  return `<article class="work-card">
  <div class="work-card__topline"><span class="status-badge">${escapeHtml(work.status)}</span><span class="work-card__number">${escapeHtml(work.cardNumber)}</span></div>
  <h3>${escapeHtml(work.title)}</h3>
  <p class="work-card__original">${escapeHtml(work.originalTitle)}</p>
  <p class="work-card__author">${escapeHtml(work.byline)}</p>
  ${details}
  <dl class="work-card__meta">
    <div><dt>英語読書記録</dt><dd>${work.recordCount}件</dd></div>
    <div><dt>最終更新日</dt><dd>${formatDateOrEmpty(work.lastUpdated)}</dd></div>
  </dl>
  <div class="work-card__actions">
    <a class="button button--primary" href="works/${encodeURIComponent(work.id)}/#record-index-title">英語読書記録を見る</a>
    <a class="button button--secondary" href="works/${encodeURIComponent(work.id)}/guide/">作品ガイド</a>
  </div>
</article>`;
}

async function buildWorkPage(work) {
  const route = `works/${work.id}/`;
  const content = renderTemplate(templates.work, {
    header: renderHeader("../../"),
    homeHref: "../../",
    workTitle: escapeHtml(work.title),
    originalTitle: escapeHtml(work.originalTitle),
    byline: escapeHtml(work.byline),
    status: escapeHtml(work.status),
    recordCount: String(work.recordCount),
    lastUpdated: formatDateOrEmpty(work.lastUpdated),
    introduction: escapeHtml(work.introduction),
    recordList: renderRecordList(work.records, { includeWork: false, fromRoot: false }),
    guideHref: "guide/",
    gutenbergUrl: escapeHtml(work.gutenbergUrl),
    footer: renderFooter(),
  });

  await addHtmlPage(route, renderBase({
    route,
    pageTitle: `${work.title} — ${site.title}`,
    description: `${work.author}『${work.title}』の英語読書記録一覧。${work.introduction}`,
    bodyClass: "work-page",
    content,
  }), newestDate([work.lastUpdated, work.metadataUpdatedAt]));
}

async function buildGuidePage(work) {
  const route = `works/${work.id}/guide/`;
  const guideContent = await readFile(work.guidePath, "utf8");
  const content = renderTemplate(templates.guide, {
    header: renderHeader("../../../"),
    homeHref: "../../../",
    workHref: "../",
    workTitle: escapeHtml(work.title),
    originalTitle: escapeHtml(work.originalTitle),
    guideByline: escapeHtml(work.guideByline),
    guideTags: work.guideTags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join(""),
    guideContent,
    footer: renderFooter(),
  });

  await addHtmlPage(route, renderBase({
    route,
    pageTitle: `${work.title} 作品ガイド — ${site.title}`,
    description: `${work.authorJa}『${work.title}』の時代背景、構成、主題、英語で読む手がかりをまとめた作品ガイド。`,
    bodyClass: "guide-page-body",
    content,
  }), work.guideUpdatedAt);
}

async function buildRecordPages(work) {
  const ascending = [...work.records].sort((a, b) => Number(a.number) - Number(b.number));
  for (let index = 0; index < ascending.length; index += 1) {
    const record = ascending[index];
    const previous = ascending[index - 1];
    const next = ascending[index + 1];
    const route = `reading/${work.id}/${record.number}/`;
    const navigation = [
      previous ? `<a href="../${previous.number}/">前の記録 ${previous.number}</a>` : "",
      next ? `<a href="../${next.number}/">次の記録 ${next.number}</a>` : "",
    ].join("");
    const content = renderTemplate(templates.record, {
      header: renderHeader("../../../"),
      homeHref: "../../../",
      workHref: `../../../works/${encodeURIComponent(work.id)}/`,
      workTitle: escapeHtml(work.title),
      recordWorkTitle: escapeHtml(`${work.authorJa}「${work.title}」`),
      recordNumber: escapeHtml(record.number),
      dateIso: record.updatedAt ? dateIso(record.updatedAt) : "",
      dateDisplay: record.updatedAt ? formatDate(record.updatedAt) : "未公開",
      recordContent: record.html || '<p class="empty-state">この記録には、まだ本文がありません。</p>',
      recordNavigation: navigation,
      footer: renderFooter(),
    });

    await addHtmlPage(route, renderBase({
      route,
      pageTitle: `${record.title} — ${site.title}`,
      description: `${work.author}『${work.title}』を英語で読む学習記録 ${record.number}。`,
      bodyClass: "record-page",
      content,
    }), record.updatedAt);

  }
}

function renderRecordList(items, { includeWork, fromRoot }) {
  if (items.length === 0) {
    return '<p class="empty-state">最初の英語読書記録を準備しています。</p>';
  }

  return `<ol class="record-list">${items.map((record) => {
    const work = works.find((candidate) => candidate.id === record.workId);
    const href = fromRoot
      ? `reading/${encodeURIComponent(record.workId)}/${record.number}/`
      : `../../reading/${encodeURIComponent(record.workId)}/${record.number}/`;
    return `<li><a href="${href}"><span>${includeWork ? `<span class="record-list__work">${escapeHtml(work.title)} / ${escapeHtml(work.originalTitle)}</span>` : ""}<span class="record-list__title">${escapeHtml(record.title)}</span></span><time datetime="${record.updatedAt ? dateIso(record.updatedAt) : ""}">${record.updatedAt ? formatDate(record.updatedAt) : "未公開"}</time></a></li>`;
  }).join("")}</ol>`;
}

function renderHeader(homeHref) {
  return `<header class="site-header"><div class="shell site-header__inner"><a class="site-brand" href="${homeHref}">${escapeHtml(site.title)}</a><p class="site-header__note">Literature in English, one page at a time.</p></div></header>`;
}

function renderFooter() {
  return `<footer class="site-footer"><p>英語で文学</p></footer>`;
}

function renderBase({ route, pageTitle, description, bodyClass, content }) {
  return renderTemplate(templates.base, {
    description: escapeHtml(description),
    pageTitle: escapeHtml(pageTitle),
    canonicalUrl: escapeHtml(canonicalUrl(route)),
    assetPrefix: relativeRootPrefix(route),
    bodyClass: escapeHtml(bodyClass),
    content,
  });
}

function renderTemplate(template, values) {
  const rendered = template.replace(/{{([A-Za-z0-9]+)}}/g, (match, key) => {
    if (!(key in values)) throw new Error(`テンプレート値 ${key} がありません。`);
    return String(values[key]);
  });
  const unresolved = rendered.match(/{{[A-Za-z0-9]+}}/);
  if (unresolved) throw new Error(`未解決のテンプレート値があります: ${unresolved[0]}`);
  return rendered;
}

async function addHtmlPage(route, html, updatedAt) {
  const outputFile = path.join(OUTPUT_DIR, route, "index.html");
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${html.trim()}\n`, "utf8");
  pages.push({ route, outputFile, updatedAt });
}

async function buildSitemap() {
  const urls = pages.map(({ route, updatedAt }) => {
    const lastModified = updatedAt ? `\n    <lastmod>${dateIso(updatedAt)}</lastmod>` : "";
    return `  <url>\n    <loc>${escapeXml(canonicalUrl(route))}</loc>${lastModified}\n  </url>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  await writeFile(path.join(OUTPUT_DIR, "sitemap.xml"), xml, "utf8");
}

async function buildRobots() {
  const content = `User-agent: *\nAllow: /\n\nSitemap: ${canonicalUrl("sitemap.xml")}\n`;
  await writeFile(path.join(OUTPUT_DIR, "robots.txt"), content, "utf8");
}

async function validateGeneratedLinks() {
  for (const page of pages) {
    const html = await readFile(page.outputFile, "utf8");
    const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
    for (const reference of references) {
      if (/^(?:https?:|mailto:|tel:|data:|#)/i.test(reference) || reference === "") continue;
      const cleanReference = decodeURIComponent(reference.split(/[?#]/)[0]);
      let target = path.resolve(path.dirname(page.outputFile), cleanReference);
      if (cleanReference.endsWith("/") || (existsSync(target) && (await stat(target)).isDirectory())) {
        target = path.join(target, "index.html");
      }
      if (!existsSync(target)) {
        throw new Error(`${path.relative(ROOT, page.outputFile)} から参照する「${reference}」が見つかりません。`);
      }
    }
  }
}

function canonicalUrl(route) {
  return new URL(route, site.siteUrl).href;
}

function relativeRootPrefix(route) {
  const depth = route.split("/").filter(Boolean).length;
  return depth === 0 ? "" : "../".repeat(depth);
}

function compareRecordsByUpdate(a, b) {
  const difference = (b.updatedAt?.valueOf() ?? 0) - (a.updatedAt?.valueOf() ?? 0);
  if (difference !== 0) return difference;
  const workDifference = a.workId.localeCompare(b.workId);
  return workDifference !== 0 ? workDifference : Number(b.number) - Number(a.number);
}

function newestDate(dates) {
  const validDates = dates.filter(Boolean);
  if (validDates.length === 0) return null;
  return new Date(Math.max(...validDates.map((date) => date.valueOf())));
}

function formatDateOrEmpty(date) {
  return date ? formatDate(date) : "まだ記録はありません";
}

function formatDate(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: site.timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function dateIso(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: site.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value);
}
