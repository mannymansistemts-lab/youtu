// api/trends.js
export default async function handler(req, res) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  try {
    const YT_KEY = process.env.YOUTUBE_API_KEY;
    if (!YT_KEY) {
      console.error('❌ Missing YOUTUBE_API_KEY in environment!');
      return res.status(500).json({ error: 'Missing YOUTUBE_API_KEY in env' });
    }

    const brand = (req.query.brand || '').trim();
    const campaign = (req.query.campaign || '').trim();
    const summary = (req.query.summary || '').trim();
    const country = (req.query.country || 'MX').trim();

    if (!brand) return res.status(400).json({ error: 'brand query param required' });

    // construir consulta a YouTube
    const q = encodeURIComponent(`${brand} ${campaign}`.trim());
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=12&q=${q}&regionCode=${country}&relevanceLanguage=es&key=${YT_KEY}`;

    const searchResp = await fetch(searchUrl);
    if (!searchResp.ok) throw new Error(`Search failed: ${searchResp.status}`);
    const searchJson = await searchResp.json();
    const items = searchJson.items || [];
    const videoIds = items.map(i => i.id?.videoId).filter(Boolean).join(',');

    // Verificar si encontró videos
    if (!videoIds) {
      console.warn('⚠️ No videos found for query');
    }

    // Tags y horas
    let ytTags = [], publishedHours = [];
    if (videoIds) {
      const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds}&key=${YT_KEY}`;
      const videosResp = await fetch(videosUrl);
      if (!videosResp.ok) throw new Error(`Videos fetch failed: ${videosResp.status}`);
      const videosJson = await videosResp.json();
      for (const v of (videosJson.items || [])) {
        const tags = v.snippet.tags || [];
        ytTags.push(...tags.map(t => t.toLowerCase()));
        const desc = v.snippet.description || '';
        const found = (desc.match(/#[\p{L}\p{N}_]+/gu) || []).map(h => h.toLowerCase());
        ytTags.push(...found);
        if (v.snippet.publishedAt) {
          const date = new Date(v.snippet.publishedAt);
          const hourMX = (date.getUTCHours() - 6 + 24) % 24;
          publishedHours.push(hourMX);
        }
      }
    }

    // Normalizar hashtags
    const normalize = s => s.toLowerCase().replace(/[^\w#\sáéíóúüñ\-]/g,'').trim();
    const freq = {};
    ytTags.map(normalize).filter(Boolean).forEach(t => freq[t] = (freq[t]||0)+1);
    const sorted = Object.keys(freq).sort((a,b)=>freq[b]-freq[a]);

    // Hashtags fijos
    const fixedA = '#vendemasporcatalogo';
    const fixedB = '#catalogosvirtualeslatam';
    const maxPerChannel = 7;
    const resultA = [fixedA];
    const resultB = [fixedB];
    for (const t of sorted) {
      if (resultA.length >= maxPerChannel && resultB.length >= maxPerChannel) break;
      const h = t.startsWith('#') ? t : '#'+t.replace(/\s+/g,'');
      if (!resultA.includes(h) && !resultB.includes(h) && h!==fixedA && h!==fixedB) {
        if (resultA.length <= resultB.length && resultA.length < maxPerChannel) resultA.push(h);
        else if (resultB.length < maxPerChannel) resultB.push(h);
        else if (resultA.length < maxPerChannel) resultA.push(h);
      }
    }

    // Studio tags
    const studioTags = [`${brand} ${campaign}`, `${brand} ${new Date().getFullYear()}`, `${brand} ${country}`];
    if (summary) summary.split(',').map(s=>s.trim()).filter(Boolean).forEach(k=>studioTags.push(`${k} ${brand}`));

    // Mejor horario
    let bestHours = publishedHours.length ? Object.entries(publishedHours.reduce((a,h)=>{a[h]=(a[h]||0)+1;return a},{ } ))
      .sort((a,b)=>b[1]-a[1]).slice(0,3).map(h=>parseInt(h[0])) : [19,20];

    const year = new Date().getFullYear();
    const titleA = `${brand} ${campaign} ${year} | Ofertas y Novedades - Vende Más`;
    const titleB = `${brand} ${campaign} ${year} | Catálogo Virtual LATAM`;
    const descA = `${summary?summary+'\n\n':''}Descubre lo nuevo de ${brand} ${campaign} ${year}. ${fixedA}`;
    const descB = `${summary?summary+'\n\n':''}Explora el catálogo virtual de ${brand} ${campaign} ${year}. ${fixedB}`;

    // ✅ Respuesta final
    return res.json({
      ok: true,
      brand, campaign, summary, country,
      channelA: { title: titleA, description: descA, hashtags: resultA },
      channelB: { title: titleB, description: descB, hashtags: resultB },
      tags: studioTags,
      bestHours,
      sampleCount: items.length
    });

  } catch (err) {
    console.error('❌ ERROR API:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
