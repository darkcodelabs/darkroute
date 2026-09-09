import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Console } from './console/Console.tsx';

const host = document.getElementById('root');
if (host === null) throw new Error('no #root to mount the console into');

createRoot(host).render(
  <StrictMode>
    <Console />
  </StrictMode>,
);
