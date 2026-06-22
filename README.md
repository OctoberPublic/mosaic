# マイ・メガモザイク（Fill-a-Pix / Mosaic パズル）

Steam の「Mega Mosaic」と同じルールの **Fill-a-Pix（モザイク）** ロジックパズルを、
Web ベースで自作したものです。iPhone の Safari から「ホーム画面に追加」してアプリのように遊べます。

## ルール
- 盤面の一部のマスに 0〜9 の数字（ヒント）が書かれています。
- 各数字は「**そのマスを中心とした最大 3×3＝9 マスのうち、塗る（黒）マスの数**」を表します。
- すべての数字の条件を満たすように塗ると、隠れた絵が完成＝クリアです。
- 数字が **赤** になったら、その条件は今の塗り方では満たせない（＝間違い）の合図です。

## 操作
- **「塗る」/「印」ボタンを押している間だけ**塗れます。片手の指でボタンを押し続けながら、もう一方の指で盤面をなぞって連続塗り（同じマスを再度なぞると消えます）。
- **ボタンを押していない間**は、1 本指スワイプで盤面を移動。**2 本指**でピンチズーム。
- 下のツールバー：`塗る`(長押し) / `印`(長押し) / `戻す` / `進む` / `ヒント` / `縮小` / `拡大` / `全体表示`。
- 左上 `☰` で難易度変更・新しい問題・リセット。右上 `📊` で統計（総プレイ時間・プレイ数・クリア数・ヒント数）。

## 難易度
| 難易度 | サイズ | 形 | 特徴 |
|---|---|---|---|
| ふつう | 30×30 | 長方形 | ヒント多め |
| むずかしい | 35×35 | 長方形 | ヒント少なめ |
| 鬼（既定）| 30〜40（毎回変動）| いびつな形 | ヒント最小・重なり推論必須 |

問題は毎回**ランダム生成**され、**唯一解かつ論理だけで解ける**ことを保証しています
（生成は Web Worker で実行し、次の問題は先読み生成。鬼は初回生成に数秒かかります）。

## ローカルで動かす
ES Modules と Web Worker を使うため、`file://` ではなく簡易サーバ経由で開きます。
```
python -m http.server 8000
# ブラウザで http://localhost:8000/ を開く
```

## iPhone のホーム画面に登録（PWA）
1. 後述の手順で GitHub Pages などに公開し、URL を発行する。
2. iPhone の **Safari** でその URL を開く。
3. 共有ボタン → **「ホーム画面に追加」**。
4. 追加されたアイコンから起動すると、全画面（standalone）で動きます。オフラインでも遊べます。

## GitHub Pages へのデプロイ
1. GitHub で新規リポジトリを作成。
2. このフォルダの中身一式を push（`index.html` がリポジトリ直下に来るように）。
3. リポジトリの **Settings ▸ Pages** で、Source を「Deploy from a branch」、ブランチを `main` / `/(root)` に設定。
4. 数十秒後、`https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます（HTTPS なので PWA/Service Worker が有効）。

参考コマンド（ターミナルで実行）:
```
git init
git add .
git commit -m "Initial commit: マイ・メガモザイク"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
git push -u origin main
```

## 構成
```
index.html              画面 / iOS用metaタグ
css/style.css           スタイル
js/solver.js            論理ソルバー(基本+重なり推論)・唯一解判定
js/generator.js         パズル生成(領域/解/ヒント最小化/難易度)
js/worker.js            生成用 Web Worker
js/puzzleSource.js      Worker管理・先読み生成・フォールバック
js/render.js            Canvas描画・ピンチズーム/パン/ドラッグ塗り
js/game.js              操作・アンドゥ/リドゥ・ヒント・エラー・クリア判定
js/storage.js           localStorage(設定/統計/進捗セーブ)
js/main.js              全体配線・画面遷移・タイマー
manifest.webmanifest    PWAマニフェスト
sw.js                   Service Worker(オフライン対応)
icons/                  アプリアイコン
tools/                  生成/ゲームのテスト・アイコン生成・確認用(配信に影響なし)
```

## 開発用テスト
```
node tools/test-generator.mjs   # 生成: 唯一解・論理可解・難易度・生成時間
node tools/test-game.mjs        # ゲーム: 塗り/エラー/アンドゥ/ヒント/クリア
node tools/make-icons.mjs       # アイコン再生成
```
