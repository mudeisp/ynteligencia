# Plantas abertas no desktop

Correção de UX para o capítulo de plantas das LPs públicas.

- Desktop: plantas com imagem voltam a aparecer abertas visualmente; até 6 ficam expostas de imediato e as demais ficam em `Ver todas as plantas`.
- Mobile: preserva o seletor compacto, anterior/próxima e CTA contextual.
- Imagens seguintes usam `loading="lazy"`.
- Plantas sem imagem fornecida pelo catálogo continuam textuais; nenhuma imagem é inferida ou inventada.
- Sem mudanças em tracking, leads, URLs, canonical, Supabase schema ou Ads.

Auditoria de origem confirmou que Casa Senses (Órulo 73079) e Eden Park by Dror Apto 1 (Órulo 74314) têm descrições de plantas no payload armazenado, mas não têm URL de imagem associada. Lúmea Camburi (Órulo 68779) fornece URLs xlarge válidas para todas as 9 plantas.
