import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Service Worker は vite-plugin-pwa が injectRegister:'auto' で自動登録する。
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
