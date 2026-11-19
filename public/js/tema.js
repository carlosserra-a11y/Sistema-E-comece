// Aplica o tema salvo antes da primeira pintura (evita flash). Escuro é o padrão.
(() => {
  let t = 'escuro';
  try { t = localStorage.getItem('tema') || 'escuro'; } catch { /* sem armazenamento */ }
  const mapa = { escuro: 'dark', claro: 'light', auto: 'auto', contraste: 'contraste' };
  document.documentElement.dataset.theme = mapa[t] ?? 'dark';
  try { document.documentElement.dataset.densidade = localStorage.getItem('densidade') || 'confortavel'; } catch { /* ignora */ }
})();
