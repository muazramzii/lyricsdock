import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Overlay } from './features/overlay/Overlay';
import { SettingsApp } from './features/settings/SettingsApp';
import { currentWindowLabel } from './services/tauri';
import './styles/base.css';
import './styles/overlay.css';
import './styles/settings.css';

function Root() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    void currentWindowLabel().then((l) => {
      document.documentElement.dataset.view = l;
      setLabel(l);
    });
  }, []);
  if (label === null) return null;
  return label === 'settings' ? <SettingsApp /> : <Overlay />;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
