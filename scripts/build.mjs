import { readFile, readdir, mkdir, rm, cp, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const site = JSON.parse(await readFile(path.join(root, 'site.config.json'), 'utf8'));
const base = await readFile(path.join(root, 'src/templates/base.html'), 'utf8');
const md = new MarkdownIt({ html: false });
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function parseFrontMatter(source, slug) {
  const data = {};
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const field = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!field || Object.hasOwn(data, field[1])) throw Error(`${slug}: メタ情報の形式または重複を確認してください`);
    let value = field[2];
    if (value === '|') {
      const block = [];
      while (i + 1 < lines.length && (lines[i + 1] === '' || /^[ \t]+/.test(lines[i + 1]))) {
        i += 1;
        block.push(lines[i].replace(/^[ \t]{2}/, ''));
      }
      while (block.length && !block[0].trim()) block.shift();
      while (block.length && !block.at(-1).trim()) block.pop();
      if (!block.length || block.some(blockLine => !blockLine.trim())) throw Error(`${slug}: ${field[1]} は空行を含まない複数行で記述してください`);
      value = block.join('\n');
    } else if (value.startsWith('"')) {
      value = JSON.parse(value);
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw Error('引用符が閉じていません');
      value = value.slice(1, -1).replace(/''/g, "'");
    }
    data[field[1]] = value;
  }
  return data;
}

function renderFold(title, body) {
  return `<details class="fold-section">
  <summary><span class="fold-section__title" role="heading" aria-level="2">${esc(title)}</span><span class="fold-section__mark" aria-hidden="true"></span></summary>
  <div class="fold-section__body">${md.render(body)}</div>
</details>`;
}

function renderWorkMarkdown(source, slug) {
  const guideHeading = /^##[ \t]+作品ガイド[ \t]*$/m.exec(source);
  const storyHeading = /^##[ \t]+(短く読む『[^』\r\n]+』)[ \t]*$/m.exec(source);
  if (!guideHeading || !storyHeading || guideHeading.index >= storyHeading.index) {
    throw Error(`${slug}: 「作品ガイド」「短く読む『作品名』」の見出しを、この順で記述してください`);
  }

  const afterHeading = match => {
    const end = match.index + match[0].length;
    return source[end] === '\n' ? end + 1 : end;
  };
  const introduction = source.slice(0, guideHeading.index).trim();
  const guideBody = source.slice(afterHeading(guideHeading), storyHeading.index).trim();
  const storyBody = source.slice(afterHeading(storyHeading)).trim();
  if (!guideBody || !storyBody) throw Error(`${slug}: 折りたたみセクションの本文がありません`);

  return [
    introduction ? md.render(introduction) : '',
    renderFold('作品ガイド', guideBody),
    renderFold(storyHeading[1], storyBody),
  ].filter(Boolean).join('\n');
}

const works = [];
for (const entry of (await readdir(path.join(root, 'works'), {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const folder = path.join(root, 'works', entry.name);
  const source = (await readFile(path.join(folder, 'index.md'), 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw Error(`${entry.name}: front matter が必要です`);
  const data = parseFrontMatter(match[1], entry.name);
  for (const key of ['title','author','year','slug','date','region','art_quote','museumUrl']) if (!data[key]) throw Error(`${entry.name}: ${key} が必要です`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug) || data.slug !== entry.name) throw Error(`${entry.name}: slug とフォルダ名を一致させてください`);
  if (!/^\d{4}$/.test(data.year)) throw Error(`${entry.name}: year は4桁です`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw Error(`${entry.name}: date は YYYY-MM-DD 形式で記述してください`);
  const parsedDate = new Date(`${data.date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10) !== data.date) throw Error(`${entry.name}: date に実在する日付を記述してください`);
  if (!['japan','foreign'].includes(data.region)) throw Error(`${entry.name}: region は japan または foreign を指定してください`);
  const artQuoteLines = data.art_quote.split('\n').map(line => line.trim());
  if (artQuoteLines.length < 2 || artQuoteLines.length > 4) throw Error(`${entry.name}: art_quote は2〜4行で記述してください`);
  if (artQuoteLines.some(line => !line)) throw Error(`${entry.name}: art_quote に空行を含めないでください`);
  if (/[「」“”]/.test(data.art_quote)) throw Error(`${entry.name}: art_quote に引用符を含めないでください（表示時に “ ” が自動で付きます）`);
  data.art_quote = artQuoteLines.join('\n');
  if (!['https:','http:'].includes(new URL(data.museumUrl).protocol)) throw Error('museumUrl はWebページのURLにしてください');
  if (!match[2].trim()) throw Error(`${entry.name}: 本文がありません`);
  await access(path.join(folder,'art.webp'));
  works.push({...data, folder, html:renderWorkMarkdown(match[2], data.slug)});
}
if (!works.length) throw Error('works/ に作品がありません');
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
await cp(path.join(root,'src/assets'),path.join(out,'assets'),{recursive:true});
await cp(path.join(root,'google296662f7c3e82eca.html'),path.join(out,'google296662f7c3e82eca.html'));
await writeFile(path.join(out,'.nojekyll'),'');
const pages = [];
async function page(route,title,content,twitterImage) {
  const prefix = route ? '../../' : './';
  const values = {pageTitle:esc(title),description:esc(site.description),canonicalUrl:esc(new URL(route,site.siteUrl).href),twitterImage:esc(twitterImage),assetPrefix:prefix,content};
  const html = base.replace(/\{\{(\w+)\}\}/g,(_,key)=> { if (!(key in values)) throw Error(`Unknown template key: ${key}`); return values[key]; });
  const dir = path.join(out,route);
  await mkdir(dir,{recursive:true});
  await writeFile(path.join(dir,'index.html'),html);
  pages.push({route,html});
}
const regionGroups = [
  {key:'japan', label:'日本文学'},
  {key:'foreign', label:'海外文学'},
];
const renderCard = w => `<a class="work-card" href="works/${w.slug}/"><img src="works/${w.slug}/art.webp" alt="" width="240" height="240"><div><h4>${esc(w.title)}</h4><p>${esc(w.author)}<span class="year">${esc(w.year)}年</span></p></div></a>`;
const renderRegion = ({key,label}) => {
  const regionWorks = works.filter(w=>w.region === key).sort((a,b)=>b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  return `<section class="work-group" aria-labelledby="region-${key}"><h3 id="region-${key}" class="region-title">${label}</h3><div class="works">${regionWorks.map(renderCard).join('')}</div></section>`;
};
await page('',site.title,`<main id="main-content" class="home"><header class="intro"><p class="eyebrow">短く読む文学</p><h1>Literature in Brief</h1><p class="description">古典や名作を、あらすじではなく、短い読み物として。<br>長い原作へ踏み出す前の、小さな入口です。</p></header><section aria-labelledby="works-title"><h2 id="works-title" class="list-title">作品一覧</h2>${regionGroups.map(renderRegion).join('')}</section></main>`,new URL('works/ningen-sikkaku/art.webp',site.siteUrl).href);
for (const w of works) {
  const route = `works/${w.slug}/`;
  const artQuote = esc(w.art_quote).replace(/\n/g, '<br>');
  await page(route,`${w.title} — ${site.title}`,`<main id="main-content" class="reading"><nav aria-label="サイト"><a href="../../">Literature in Brief <span aria-hidden="true">／</span> 短く読む文学</a></nav><article><header class="work-heading"><p class="eyebrow">短く読む文学</p><h1>${esc(w.title)}</h1><p>${esc(w.author)}<span class="year">原作 ${esc(w.year)}年</span></p></header><div class="prose">${w.html}</div><section class="artwork"><blockquote class="art-quote"><span class="art-quote__text"><span class="art-quote__mark art-quote__mark--open" aria-hidden="true">“</span>${artQuote}<span class="art-quote__mark art-quote__mark--close" aria-hidden="true">”</span></span></blockquote><a href="${esc(w.museumUrl)}"><img src="art.webp" alt="『${esc(w.title)}』から生まれたペン画" loading="lazy" decoding="async"></a><p><a href="${esc(w.museumUrl)}">静かな美術館でこの作品を見る <span aria-hidden="true">→</span></a></p></section></article><p class="back"><a href="../../">← 作品一覧へ</a></p></main>`,new URL(`works/${w.slug}/art.webp`,site.siteUrl).href);
  await cp(path.join(w.folder,'art.webp'),path.join(out,route,'art.webp'));
}
await writeFile(path.join(out,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(p=>`<url><loc>${esc(new URL(p.route,site.siteUrl).href)}</loc></url>`).join('')}</urlset>`);
await writeFile(path.join(out,'robots.txt'),`User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap.xml',site.siteUrl).href}\n`);
for (const p of pages) {
  for (const [,link] of p.html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(?:https?:|#)/.test(link)) continue;
    const target = path.resolve(out,p.route,link.endsWith('/') ? `${link}index.html` : link);
    if (!target.startsWith(out + path.sep)) throw Error(`出力外へのリンク: ${link}`);
    await access(target);
  }
}
console.log(`Built and checked ${pages.length} pages in dist/ (${works.length} works).`);
