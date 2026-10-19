import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyCachedTheme } from './theme';
import './styles/tokens.css';
import './styles/base.css';
import './styles/forms.css';

applyCachedTheme();

// Ask the browser not to evict our IndexedDB data under storage pressure (requirements spec 3).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
