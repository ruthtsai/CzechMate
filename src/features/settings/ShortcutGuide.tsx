import { useToast } from '../../components/ui';

// F-02: iOS share-sheet shortcut that posts straight to the Apps Script (quickAdd), so it works no matter
// which copy of the app is open. A home-screen PWA cannot be a share target on iOS, and opening the app's
// address from a shortcut lands in a Safari tab whose storage is separate from the home-screen app.

const FIELDS: [string, string, string][] = [
  ['文字', 'app', 'CzechMate'],
  ['數字', 'protocol', '1'],
  ['文字', 'secret', '（貼上金鑰）'],
  ['文字', 'action', 'quickAdd'],
  ['文字', 'input', '變數「捷徑輸入」'],
  ['文字', 'title', '變數「捷徑輸入」，再點它改成「名稱」']
];

function FieldTable({ rows }: { rows: [string, string, string][] }) {
  return (
    <table className="fields">
      <tbody>
        {rows.map(([type, key, value]) => (
          <tr key={key}><td>{type}</td><td><code>{key}</code></td><td>{value}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function ShortcutGuide({ url, secret, supported }: { url: string; secret: string; supported: boolean }) {
  const toast = useToast();

  // iOS only allows clipboard writes directly inside the tap, so nothing is awaited before writeText.
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast(`已複製${what}。`),
      () => toast(`無法自動複製${what}，請改用長按選取。`, { ok: false })
    );

  return (
    <div className="setgroup">
      <h3>iOS 分享捷徑</h3>
      <p className="small" style={{ margin: 0 }}>
        在 Safari、Dcard 按「分享 › 存到 CzechMate」，就會直接寫進試算表的「資源」，標上「待整理」標籤。下次打開 App 就會出現。同一個網址不會重複存。
      </p>
      {!supported && (
        <div className="hint warn">
          目前部署的腳本還不是最新版。請按上方「複製腳本」，到 Apps Script 全部取代並儲存，再「部署 › 管理部署作業 › 編輯 › 版本：新版本 › 部署」（第一次會多要求一個「連線到外部服務」的權限，用來抓網頁標題），然後按「測試連線」。
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={() => copy(url, '腳本網址')}>複製腳本網址</button>
        <button type="button" className="btn btn-secondary" onClick={() => copy(secret, '金鑰')}>複製金鑰</button>
      </div>

      <h4 className="guide-h">建立捷徑</h4>
      <ol className="small steps">
        <li>打開「捷徑」App，按右上角「＋」，把名稱改成「存到 CzechMate」。</li>
        <li>
          點下方的 ⓘ，打開「在分享表單中顯示」後按完成。最上面會出現「從分享表單接收任何輸入」：點「任何」，只留「URL」、「文字」、「Safari 網頁」；「如果沒有輸入」選「停止並回應」。
        </li>
        <li>
          搜尋並加入「取得 URL 內容」動作：
          <ul>
            <li>網址：貼上剛才複製的腳本網址。</li>
            <li>點「顯示更多」：方法選 <b>POST</b>，要求本文選 <b>JSON</b>。</li>
            <li>
              按「新增欄位」加入下面 6 個欄位（類型／鍵／值）。值要用變數時，點值的格子，在鍵盤上方的變數列點「捷徑輸入」。
              <FieldTable rows={FIELDS} />
              <code>title</code> 讓 Safari 把網頁標題一起送過去：放好「捷徑輸入」後再點它一次，選「名稱」。Medium 這類網站不讓 Google 讀取，沒有這個欄位就只能從網址猜標題。
            </li>
          </ul>
        </li>
        <li>加入「取得辭典值」動作，設成取得「URL 內容」裡 <code>message</code> 的「值」。</li>
        <li>加入「顯示通知」動作，內容選「辭典值」。</li>
        <li>試用：在 Safari 開一個網頁，按「分享 › 存到 CzechMate」，應該會跳出「已存入資源庫：…」。</li>
      </ol>

      <h4 className="guide-h">選用：存的時候先選類型、階段</h4>
      <p className="small" style={{ margin: 0 }}>
        不設定也可以：類型會自動判斷（Dcard 網址是 Dcard、其他網址是網站、只有文字是筆記），階段預設「不分」，之後在試算表改就好。想每次存的時候順便選，就照下面做，每多一個選項，存的時候就多跳一次選單。
      </p>
      <ol className="small steps">
        <li>
          在「取得 URL 內容」<b>上面</b>加入「清單」動作，把預設的兩項改成四項：出發前、抵達後、旅遊、不分（按「新增項目」加到四項）。
        </li>
        <li>在它下面加入「從清單中選擇」動作，提示文字可以填「階段？」。</li>
        <li>
          要選類型的話，再加一組「清單」（筆記、Dcard、網站、截圖、文件）和「從清單中選擇」（提示填「類型？」）。
        </li>
        <li>
          回到「取得 URL 內容」，多加欄位：
          <FieldTable rows={[['文字', 'stage', '變數：階段那個「所選項目」'], ['文字', 'type', '變數：類型那個「所選項目」']]} />
          兩個「所選項目」會依序標成「所選項目」和「所選項目 2」，先加的是階段。
        </li>
        <li>
          想加備註或標籤：加入「要求輸入」動作，再多加欄位 <code>note</code>（值選「提供的輸入」）。標籤用 <code>tags</code> 欄位，多個用分號隔開。
        </li>
      </ol>
      <p className="small muted" style={{ margin: 0 }}>
        完成後動作順序會是：清單 → 從清單中選擇（階段）→〔清單 → 從清單中選擇（類型）〕→ 取得 URL 內容 → 取得辭典值 → 顯示通知。
      </p>

      <p className="muted tiny" style={{ margin: 0 }}>
        捷徑裡存了你的金鑰，請不要把這個捷徑分享給別人。按「更換金鑰」後，記得把捷徑裡 secret 的值也換成新的。
      </p>
    </div>
  );
}
