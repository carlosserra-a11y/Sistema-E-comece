/** Janela deslizante em memória. Suficiente para um único processo; trocar por Redis ao escalar. */
export function criarLimitador(agora = () => Date.now()) {
  const mapa = new Map();
  const limpar = () => {
    const t = agora();
    for (const [k, v] of mapa) if (!v.length || v[v.length - 1] < t - 3600_000) mapa.delete(k);
  };
  const timer = setInterval(limpar, 60_000);
  timer.unref?.();
  return {
    /** Registra uma tentativa. Retorna { ok, retryAfterS }. */
    bater(chave, max, janelaMs) {
      const t = agora();
      const arr = (mapa.get(chave) ?? []).filter((x) => x > t - janelaMs);
      if (arr.length >= max) {
        mapa.set(chave, arr);
        return { ok: false, retryAfterS: Math.max(1, Math.ceil((arr[0] + janelaMs - t) / 1000)) };
      }
      arr.push(t);
      mapa.set(chave, arr);
      return { ok: true, retryAfterS: 0 };
    },
    zerar(chave) { mapa.delete(chave); },
    parar() { clearInterval(timer); },
    tamanho: () => mapa.size,
  };
}
