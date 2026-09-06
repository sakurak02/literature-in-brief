# Literature in Brief｜短く読む文学

古典や名作を、あらすじではなく、短い読み物として紹介するサイトです。
literature-in-brief リポジトリと GitHub Pages の公開方式を使用します。

## 普段の更新：4手順

1. `works/作品slug/` フォルダを作ります。日本文学はローマ字表記（例：`ningen-sikkaku`）。
2. その中に `index.md` を置き、以下のメタ情報と本文を書きます。
3. 同じフォルダにペン画を `art.webp` という名前で置きます。
4. GitHub Desktopなどで Commit & Push します。main への Push 後、GitHub Actions が自動でビルド・公開します。

```yaml
---
title: 人間失格
author: 太宰治
year: 1948
slug: ningen-sikkaku
date: 2026-09-05
region: japan
art_quote: |
  人に合わせて笑うことを覚えた少年は、
  いつしか、その笑顔の外へ
  出られなくなっていった。
museumUrl: "https://sakurak02.github.io/quiet-museum/artwork.html?id=D005"
---

## 作品ガイド

ここに作品ガイドを書きます。

## 短く読む『人間失格』

### 一　章のタイトル

ここに本編を書きます。

## 読み終えて

ここに読後の文章を書きます。
```

タイトルはメタ情報から表示されます。本文に同じ作品タイトルのH1を重ねる必要はありません。
メタ情報は上記8項目を記入してください。date は YYYY-MM-DD 形式、region は日本文学なら japan、海外文学なら foreign を指定します。
art_quote は `|` の次の行から2〜4行で記述し、各行の先頭に半角スペース2つを入れます。引用符は記入しません（ページ表示時に “ ” が自動で付きます）。その他の値は1行で記述し、配列・入れ子は使いません。
slug はフォルダ名と同じにします。半角英小文字・数字・ハイフンが使えます。
ペン画と「静かな美術館」リンクは自動表示されるため、本文への記入は不要です。
作品一覧は region ごとに「日本文学」「海外文学」へ分かれ、各区分内で date の新しい順に自動生成されます。date と region は作品カードには表示されません。HTMLや一覧データの編集は不要です。

## 構成

```text
works/ningen-sikkaku/index.md  # 日常編集する本文・メタ情報
works/ningen-sikkaku/art.webp  # ペン画
src/templates/base.html       # 共通HTML、Analytics、some cloudsリンク
src/assets/styles.css         # 共通デザイン
scripts/build.mjs             # Markdownからページ・一覧・サイトマップを生成
site.config.json              # サイト名・説明・公開URL
.github/workflows/pages.yml   # 既存の自動公開設定
dist/                         # 自動生成物（編集・コミット不要）
```

## ローカル確認（必要なときだけ）

Node.js 24以降で `npm ci`、`npm run build` を実行します。
`npm run check` もビルドし、メタ情報・画像・内部リンクを検証します。
トップは `dist/index.html`、第1作は `dist/works/ningen-sikkaku/index.html` に生成されます。
GitHub Pagesでは既存の `/literature-in-brief/` 以下の `works/ningen-sikkaku/` になります。

Analytics ID `G-J5JY0WT6EE`、Search Console確認HTML、some cloudsの既存リンク、Actionsの公開フローを維持しています。
旧記事は削除したため、旧記事へのリンクは404になります。過去の内容はGit履歴から確認できます。
