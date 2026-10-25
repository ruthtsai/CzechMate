import { useToast } from '../../components/ui';

// F-02: iOS share-sheet shortcut that posts straight to the Apps Script (quickAdd), so it works no matter
// which copy of the app is open. A home-screen PWA cannot be a share target on iOS, and opening the app's
// address from a shortcut lands in a Safari tab whose storage is separate from the home-screen app.

const FIELDS: [string, string, string][] = [
  ['文字', 'app', 'CzechMate'],
  ['數字', 'protocol', '1'],
  ['文字', 'secret', '（貼上金鑰）'],
  ['文字', 'action', 'quickAdd'],
  ['文字', 'input', '點選變數「捷徑輸入」']
];

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
          目前部署的腳本還不支援分享捷徑。請按上方「複製腳本」，到 Apps Script 全部取代並儲存，再「部署 › 管理部署作業 › 編輯 › 版本：新版本 › 部署」（這次會多要求一個「連線到外部服務」的權限，用來抓網頁標題），然後按「測試連線」。
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={() => copy(url, '腳本網址')}>複製腳本網址</button>
        <button type="button" className="btn btn-secondary" onClick={() => copy(secret, '金鑰')}>複製金鑰</button>
      </div>
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
              按「新增欄位」加入 5 個欄位（類型／鍵／值）：
              <table className="fields">
                <tbody>
                  {FIELDS.map(([type, key, value]) => (
                    <tr key={key}><td>{type}</td><td><code>{key}</code></td><td>{value}</td></tr>
                  ))}
                </tbody>
              </table>
            </li>
          </ul>
        </li>
        <li>加入「取得辭典值」動作，設成取得「URL 內容」裡 <code>message</code> 的「值」。</li>
        <li>加入「顯示通知」動作，內容選「辭典值」。</li>
        <li>試用：在 Safari 開一個網頁，按「分享 › 存到 CzechMate」，應該會跳出「已存入資源庫：…」。</li>
      </ol>
      <details className="small">
        <summary>想在存的時候選階段或加備註</summary>
        <ol className="steps">
          <li>在「取得 URL 內容」前面加入「清單」動作，填入「出發前」「抵達後」「旅遊」「不分」，再加入「從清單中選擇」。</li>
          <li>在「取得 URL 內容」多加欄位：文字 <code>stage</code>，值點選變數「所選項目」。</li>
          <li>要加備註：再加入「要求輸入」動作，並多加欄位文字 <code>note</code>，值選「提供的輸入」。標籤可以用 <code>tags</code> 欄位，多個用分號隔開。</li>
        </ol>
      </details>
      <p className="muted tiny" style={{ margin: 0 }}>
        捷徑裡存了你的金鑰，請不要把這個捷徑分享給別人。按「更換金鑰」後，記得把捷徑裡 secret 的值也換成新的。
      </p>
    </div>
  );
}
