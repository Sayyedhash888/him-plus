import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@xterm/xterm/css/xterm.css';
import './lib/monaco-setup';
import './styles/global.css';
import App from './App';
import { applyThemeCss, getTheme, readStoredThemeId } from './lib/themes';
import { registerFimProvider } from './lib/fim';
import { configureAgentHost } from './lib/agent/host';
import { createRendererAgentHost } from './lib/agent/rendererHost';

applyThemeCss(getTheme(readStoredThemeId()));
registerFimProvider();

// Install the agent's host seam before anything can run the loop. The loop reads
// session state, workspace context and model policy through this, so it no longer
// imports the renderer stores directly — which is what lets it move into the daemon.
configureAgentHost(createRendererAgentHost());

const root = document.getElementById('root');

if (!window.him) {
  root!.innerHTML = `
    <div style="height:100%;display:flex;align-items:center;justify-content:center;padding:40px;font-family:Inter,system-ui,sans-serif;background:#0B0E14;color:#E7ECF3">
      <div style="max-width:460px;border:1px solid #1F2633;background:#11151C;border-radius:12px;padding:24px">
        <div style="font-family:monospace;font-size:16px;letter-spacing:.08em;color:#5FE3E8;margin-bottom:12px">HIM+</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">Desktop runtime required</div>
        <div style="font-size:12px;line-height:1.6;color:#8A94A6">This window is missing the Electron preload bridge. Launch HIM+ with <code style="color:#93E9EE">npm run dev</code> or <code style="color:#93E9EE">npm start</code> instead of opening the Vite page directly.</div>
      </div>
    </div>`;
} else {
  createRoot(root!).render(<App />);
}
