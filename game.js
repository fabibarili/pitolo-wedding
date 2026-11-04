(() => {
  // O jogo é desenhado num canvas pequeno (view) e ampliado no canvas da
  // página; os textos vão por cima com o dobro da resolução, porque a fonte
  // Minecraft só fica nítida a partir de 16px
  const canvas = document.getElementById("game");
  const screen = canvas.getContext("2d");
  const view = document.createElement("canvas");
  const ctx = view.getContext("2d");
  const UI_SCALE = 2;
  const textQueue = [];

  // Resolução baixa de propósito: o canvas é ampliado com pixels nítidos (pixel art)
  const W = 180;
  let H = 320;
  const GROUND_H = 40;

  // Física: segurando o dedo o avião sobe, soltando ele desce, sempre suave
  const LIFT = 650;           // aceleração para cima ao segurar (px/s²)
  const GRAVITY = 450;        // aceleração para baixo ao soltar (px/s²)
  const MAX_RISE = 150;       // velocidade máxima de subida (px/s)
  const MAX_FALL = 170;       // velocidade máxima de descida (px/s)

  const BASE_SPEED = 75;      // velocidade inicial do cenário (px/s)
  const MAX_SPEED = 130;
  const BASE_INTERVAL = 1.3;  // segundos entre obstáculos no começo
  const MIN_INTERVAL = 0.7;
  const PX_PER_METER = 5;     // quantos pixels percorridos valem 1 metro

  // Pontos necessários para cada medalha
  const MEDALS = [
    { min: 30, name: "Ouro", base: "#ffd23f", dark: "#c48a00", light: "#fff1a8" },
    { min: 15, name: "Prata", base: "#c0c7d0", dark: "#7d8794", light: "#eef2f6" },
    { min: 5, name: "Bronze", base: "#cd7f32", dark: "#8a5220", light: "#e8a865" },
  ];

  const STATE = { READY: 0, PLAYING: 1, OVER: 2 };

  let state = STATE.READY;
  let plane, obstacles, score, distance, groundX, clouds, overTime;
  let speed, spawnTimer, elapsed, newRecord;
  let holding = false;
  let bestDist = loadBestDist();

  function loadBestDist() {
    try {
      return Number(localStorage.getItem("flappyPlaneBestDist")) || 0;
    } catch {
      return 0;
    }
  }

  function saveBestDist(value) {
    try {
      localStorage.setItem("flappyPlaneBestDist", String(value));
    } catch {}
  }

  // ---------- Sprites em pixel art ----------
  function makeSprite(w, h, colorAt) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const color = colorAt(x, y);
        if (color) {
          g.fillStyle = color;
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    return c;
  }

  function spriteFromRows(rows, palette) {
    const w = Math.max(...rows.map((r) => r.length));
    return makeSprite(w, rows.length, (x, y) => palette[rows[y][x]]);
  }

  // Forma feita de círculos unidos, com contorno de 1 pixel
  function blobSprite(w, h, circles, fill, outline) {
    const inside = (x, y) =>
      x >= 0 && y >= 0 && x < w && y < h &&
      circles.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);
    return makeSprite(w, h, (x, y) => {
      if (!inside(x, y)) return null;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      return edge && outline ? outline : fill(x, y);
    });
  }

  // Avião azul, nariz para a direita (centro em 12,6)
  const PLANE = spriteFromRows(
    [
      ".oo.....................",
      ".odo....................",
      ".oddo...................",
      ".oddo...................",
      ".oddoooooooooooooooo....",
      ".olllllllllllllllwwwoo..",
      ".obbbwbwbwbwbbbbbwwwbbo.",
      ".obbbbbbWWWWWWWWbbbbbbo.",
      "..obbbbbodddobbbbbbboo..",
      "...ooooooddddooooooo....",
      ".......odddo............",
      "......oddo..............",
      "......ooo...............",
    ],
    { o: "#0b2a5b", d: "#1748a8", b: "#2f7cf0", l: "#6fb4ff", w: "#cfefff", W: "#ffffff" }
  );

  // Pássaro virado para a esquerda, dois quadros de asa (centro em 8,5)
  const BIRD_PAL = { k: "#3a3a3a", g: "#6a6a6a", y: "#ff9f1c", w: "#ffffff" };
  const BIRD_BODY = [
    "...kkkkkkkkkk...",
    "..kwkkkkkkkkkkk.",
    "yykkkkkkkkkkkkkk",
    "..kggggggggkk...",
    "....kkkkkkk.....",
  ];
  const BIRD = [
    spriteFromRows(
      ["........kk......", ".......kkk......", "......kkkk......", ...BIRD_BODY, "................", "................"],
      BIRD_PAL
    ),
    spriteFromRows(
      ["................", "................", "................", ...BIRD_BODY, "......kkkk......", ".......kkk......"],
      BIRD_PAL
    ),
  ];

  // Balão de ar quente listrado (centro do balão em 11,11)
  const BALLOON = (() => {
    const ball = blobSprite(
      22, 22, [[11, 11, 10.5]],
      (x, y) => {
        if ((x === 6 || x === 7) && (y === 5 || y === 6)) return "#ffffff";
        return Math.floor(x / 4) % 2 ? "#ffd23f" : "#ff5a5f";
      },
      "#5b2a0b"
    );
    const c = document.createElement("canvas");
    c.width = 22;
    c.height = 30;
    const g = c.getContext("2d");
    g.fillStyle = "#5b2a0b";
    g.fillRect(8, 20, 1, 5);
    g.fillRect(13, 20, 1, 5);
    g.fillRect(7, 25, 8, 5);
    g.fillStyle = "#a0662b";
    g.fillRect(8, 26, 6, 3);
    g.drawImage(ball, 0, 0);
    return c;
  })();

  // Nuvem de tempestade (centro em 17,12) e o raio
  const STORM = blobSprite(
    34, 22, [[9, 13, 8], [17, 9, 9], [26, 13, 7]],
    (x, y) => (y > 15 ? "#464d5e" : "#5a6275"),
    "#2c3140"
  );
  const BOLT = spriteFromRows(["..yy", ".yy.", "yyyy", "..y.", ".y..", "y..."], { y: "#ffe14d" });

  // Nuvens decorativas do fundo
  const CLOUDS = [
    blobSprite(30, 14, [[8, 9, 6], [16, 7, 7], [23, 9, 6]], () => "#ffffff"),
    blobSprite(22, 11, [[7, 7, 5], [14, 6, 6]], () => "#ffffff"),
  ];

  // Setas das instruções da tela inicial
  const ARROW_UP = spriteFromRows(
    ["...o...", "..ogo..", ".ogggo.", "ogggggo", "ooggooo", "..ggo..", "..ooo.."],
    { o: "#1f5e20", g: "#4caf50" }
  );
  const ARROW_DOWN = spriteFromRows(
    ["..ooo..", "..rro..", "oorrooo", "orrrrro", ".orrro.", "..oro..", "...o..."],
    { o: "#7a1d1d", r: "#e05050" }
  );

  // Medalhas (círculo com brilho) e o espaço vazio quando não há medalha
  function medalSprite(m) {
    return blobSprite(
      22, 22, [[11, 11, 10.5]],
      (x, y) => {
        const d = Math.hypot(x + 0.5 - 11, y + 0.5 - 11);
        if (d > 7.5) return m.dark;
        if ((x === 7 || x === 8) && (y === 6 || y === 7)) return "#ffffff";
        return d > 6.5 ? m.light : m.base;
      },
      "#0b2a5b"
    );
  }
  MEDALS.forEach((m) => (m.sprite = medalSprite(m)));
  const MEDAL_EMPTY = blobSprite(22, 22, [[11, 11, 10.5]], () => "#c9c27a", "#a89f5a");

  // ---------- Texto com a fonte Minecraft ----------
  // A fonte é desenhada num canvas à parte e depois "binarizada" (sem
  // antialiasing), ganhando um contorno de 1 pixel e uma sombra embaixo.
  const font = new FontFace("Minecraft", "url(fonts/Minecraft.ttf)");
  font
    .load()
    .then((f) => {
      document.fonts.add(f);
      textCache.clear();
    })
    .catch(() => {});

  const textCache = new Map();
  const scratch = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function textSprite(str, size, fill, outline) {
    const key = str + "|" + size + "|" + fill + "|" + outline;
    let sprite = textCache.get(key);
    if (sprite) return sprite;
    if (textCache.size > 300) textCache.clear();

    // px = pixels da tela por pixel da fonte (a grade da fonte é de 16 por "em")
    const px = Math.max(1, Math.round(size / 16));
    const pad = px * 3;
    const fontCss = `${size}px Minecraft, monospace`;
    scratch.font = fontCss;
    const advances = [...str].map((ch) => Math.round(scratch.measureText(ch).width));
    const w = advances.reduce((a, b) => a + b, 0) + pad * 2;
    const h = Math.ceil(size * 1.25) + pad * 2;
    scratch.canvas.width = w;
    scratch.canvas.height = h;
    scratch.font = fontCss;
    scratch.textBaseline = "alphabetic";
    scratch.fillStyle = "#fff";
    let penX = pad;
    [...str].forEach((ch, i) => {
      scratch.fillText(ch, penX, pad + size);
      penX += advances[i];
    });

    const src = scratch.getImageData(0, 0, w, h).data;
    const mask = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] >= 128;
    const out = scratch.createImageData(w, h);
    const f = hexToRgb(fill);
    const o = outline && hexToRgb(outline);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let color = null;
        if (mask(x, y)) {
          color = f;
        } else if (o) {
          // Contorno em volta e sombra de 1 pixel extra para baixo
          outer: for (let dy = -2 * px; dy <= px; dy++) {
            for (let dx = -px; dx <= px; dx++) {
              if (mask(x + dx, y + dy)) {
                color = o;
                break outer;
              }
            }
          }
        }
        if (color) {
          const i = (y * w + x) * 4;
          out.data.set([color[0], color[1], color[2], 255], i);
        }
      }
    }

    sprite = document.createElement("canvas");
    sprite.width = w;
    sprite.height = h;
    sprite.getContext("2d").putImageData(out, 0, 0);
    sprite.pad = pad;
    textCache.set(key, sprite);
    return sprite;
  }

  // Escreve o texto com o topo das letras maiúsculas em y. Posição e tamanho
  // ficam nas unidades do jogo; o desenho acontece na camada de texto.
  function text(str, x, y, size = 8, opts = {}) {
    const { fill = "#ffffff", outline = "#0b2a5b", align = "center" } = opts;
    const actual = size * UI_SCALE;
    const s = textSprite(String(str), actual, fill, outline);
    const sx = x * UI_SCALE;
    let left = sx - s.pad;
    if (align === "center") left = sx - s.width / 2;
    else if (align === "right") left = sx - s.width + s.pad;
    const top = y * UI_SCALE - s.pad - Math.round(actual * 0.25);
    textQueue.push([s, Math.round(left), Math.round(top)]);
  }

  // ---------- Tamanho / tela ----------
  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Em celular em pé, preenche a tela; em telas largas, usa formato de celular
    H = Math.round(Math.min(Math.max(W * (vh / vw), 280), 400));

    const scale = Math.min(vw / W, vh / H);
    view.width = W;
    view.height = H;
    canvas.width = W * UI_SCALE;
    canvas.height = H * UI_SCALE;
    canvas.style.width = W * scale + "px";
    canvas.style.height = H * scale + "px";
    ctx.imageSmoothingEnabled = false;
    screen.imageSmoothingEnabled = false;

    if (state === STATE.READY) plane.y = H * 0.42;
  }

  // ---------- Jogo ----------
  function reset() {
    plane = { x: Math.round(W * 0.28), y: H * 0.42, vy: 0, angle: 0, t: 0 };
    obstacles = [];
    score = 0;
    distance = 0;
    groundX = 0;
    speed = BASE_SPEED;
    spawnTimer = 0;
    elapsed = 0;
    newRecord = false;
    if (!clouds) {
      clouds = Array.from({ length: 4 }, (_, i) => ({
        x: i * 50 + Math.random() * 20,
        y: 15 + Math.random() * 100,
        sprite: CLOUDS[i % CLOUDS.length],
        s: 0.6 + Math.random() * 0.6,
      }));
    }
    state = STATE.READY;
  }

  // Objetos do céu: balão, pássaro e nuvem de tempestade (r = raio de colisão)
  const TYPES = [
    { kind: "balloon", r: 11 },
    { kind: "bird", r: 7 },
    { kind: "storm", r: 14 },
  ];

  function spawnObstacle() {
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    const top = 15 + type.r;
    const bottom = H - GROUND_H - type.r - 18;
    const y = top + Math.random() * (bottom - top);
    obstacles.push({
      ...type,
      x: W + type.r + 10,
      y,
      baseY: y,
      t: Math.random() * Math.PI * 2,
      passed: false,
    });
  }

  function press() {
    holding = true;
    if (state === STATE.READY) {
      state = STATE.PLAYING;
    } else if (state === STATE.OVER && performance.now() - overTime > 900) {
      reset();
    }
  }

  function release() {
    holding = false;
  }

  function gameOver() {
    if (state === STATE.OVER) return;
    state = STATE.OVER;
    overTime = performance.now();
    const meters = Math.floor(distance);
    if (meters > bestDist) {
      newRecord = bestDist > 0;
      bestDist = meters;
      saveBestDist(bestDist);
    }
    if (navigator.vibrate) navigator.vibrate(120);
  }

  function hits(o) {
    // Colisão por círculo, um pouco menor que o desenho para ficar justo
    const dx = o.x - plane.x;
    const dy = o.y - plane.y;
    const r = o.r * 0.85 + 6;
    return dx * dx + dy * dy < r * r;
  }

  function update(dt) {
    plane.t += dt;

    for (const c of clouds) {
      c.x -= speed * 0.15 * c.s * dt;
      if (c.x < -c.sprite.width) {
        c.x = W + 10;
        c.y = 15 + Math.random() * 100;
      }
    }

    if (state === STATE.READY) {
      plane.y = H * 0.42;
      plane.angle = 0;
      groundX = (groundX - speed * dt) % 8;
      return;
    }

    // Física do avião: acelera suavemente para cima ou para baixo
    if (state === STATE.PLAYING && holding) {
      plane.vy = Math.max(plane.vy - LIFT * dt, -MAX_RISE);
    } else {
      plane.vy = Math.min(plane.vy + GRAVITY * dt, MAX_FALL);
    }
    plane.y += plane.vy * dt;

    // Teto: o avião encosta e para, sem morrer
    if (plane.y < 12) {
      plane.y = 12;
      plane.vy = Math.max(plane.vy, 0);
    }

    const target = (plane.vy / MAX_FALL) * 0.4;
    plane.angle += (target - plane.angle) * Math.min(dt * 8, 1);

    const floor = H - GROUND_H;
    if (plane.y + 6 >= floor) {
      plane.y = floor - 6;
      plane.vy = 0;
      gameOver();
    }

    if (state !== STATE.PLAYING) return;

    // Dificuldade sobe aos poucos
    elapsed += dt;
    speed = Math.min(BASE_SPEED + elapsed * 1.5, MAX_SPEED);
    const interval = Math.max(BASE_INTERVAL - elapsed * 0.012, MIN_INTERVAL);

    distance += (speed * dt) / PX_PER_METER;
    groundX = (groundX - speed * dt) % 8;

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = interval;
    }

    for (const o of obstacles) {
      o.t += dt;
      o.x -= (o.kind === "bird" ? speed * 1.25 : speed) * dt;
      if (o.kind === "bird") o.y = o.baseY + Math.sin(o.t * 3) * 12;
      if (o.kind === "balloon") o.y = o.baseY + Math.sin(o.t * 1.5) * 6;
      if (!o.passed && o.x + o.r < plane.x) {
        o.passed = true;
        score++;
      }
      if (hits(o)) gameOver();
    }

    obstacles = obstacles.filter((o) => o.x > -o.r * 2);
  }

  // ---------- Desenho ----------
  const SKY = ["#4ec0ca", "#5cc8d1", "#6fd0d8", "#86d9df", "#9ee2e7", "#b8ecf0"];

  // Céu em faixas, com uma linha quadriculada entre elas (dithering)
  function drawBackground() {
    const band = Math.ceil((H - GROUND_H) / SKY.length);
    SKY.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * band, W, band);
      if (i > 0) {
        ctx.fillStyle = SKY[i - 1];
        for (let x = 0; x < W; x += 2) ctx.fillRect(x, i * band, 1, 1);
      }
    });

    for (const c of clouds) {
      ctx.drawImage(c.sprite, Math.round(c.x), Math.round(c.y));
    }
  }

  function drawObstacles() {
    for (const o of obstacles) {
      const x = Math.round(o.x);
      const y = Math.round(o.y);
      if (o.kind === "balloon") {
        ctx.drawImage(BALLOON, x - 11, y - 11);
      } else if (o.kind === "bird") {
        ctx.drawImage(BIRD[Math.floor(o.t * 8) % 2], x - 8, y - 5);
      } else {
        if (Math.sin(o.t * 6) > 0.3) ctx.drawImage(BOLT, x - 2, y + 8);
        ctx.drawImage(STORM, x - 17, y - 12);
      }
    }
  }

  function drawGround() {
    const y = H - GROUND_H;
    ctx.fillStyle = "#ded895";
    ctx.fillRect(0, y, W, GROUND_H);
    ctx.fillStyle = "#73bf2e";
    ctx.fillRect(0, y, W, 6);
    ctx.fillStyle = "#5ea226";
    const gx = Math.round(groundX);
    for (let x = gx; x < W; x += 8) {
      ctx.fillRect(x, y + 1, 4, 4);
    }
    ctx.fillStyle = "#3f7a1a";
    ctx.fillRect(0, y + 6, W, 1);
    // Pedrinhas na terra
    ctx.fillStyle = "#c9c27a";
    for (let x = gx; x < W + 16; x += 16) {
      ctx.fillRect(x + 3, y + 12, 2, 1);
      ctx.fillRect(x + 11, y + 20, 2, 1);
      ctx.fillRect(x + 6, y + 29, 2, 1);
    }
  }

  // Avião com hélice; scale > 1 amplia mantendo os pixels (tela inicial)
  function drawPlaneAt(x, y, angle, scale = 1) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.drawImage(PLANE, -12, -6);

    // Hélice (gira mais rápido quando está subindo)
    const spin = holding && state === STATE.PLAYING ? 60 : 30;
    const blade = Math.round(Math.abs(Math.sin(plane.t * spin)) * 5) + 1;
    ctx.fillStyle = "#555555";
    ctx.fillRect(11, -blade, 1, blade * 2);
    ctx.fillStyle = "#0b2a5b";
    ctx.fillRect(10, -1, 1, 2);

    ctx.restore();
  }

  function drawPlane() {
    if (state === STATE.READY) return;
    drawPlaneAt(plane.x, plane.y, plane.angle);
  }

  // Painel com cantos "cortados", brilho em cima e sombra embaixo
  function panel(x, y, w, h, base = "#ded895", light = "#f3eeb8", dark = "#c9c27a") {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(x + 2, y + h, w - 2, 2);
    ctx.fillStyle = "#0b2a5b";
    ctx.fillRect(x + 1, y, w - 2, h);
    ctx.fillRect(x, y + 1, w, h - 2);
    ctx.fillStyle = base;
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = light;
    ctx.fillRect(x + 2, y + 2, w - 4, 2);
    ctx.fillStyle = dark;
    ctx.fillRect(x + 2, y + h - 4, w - 4, 2);
  }

  // Escurece a cena com um quadriculado, no estilo pixel art
  function dimScreen() {
    ctx.fillStyle = "rgba(11,42,91,0.45)";
    for (let y = 0; y < H; y++) {
      for (let x = y % 2; x < W; x += 2) ctx.fillRect(x, y, 1, 1);
    }
  }

  const easeOutBack = (p) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
  const blink = (rate = 2) => Math.floor(performance.now() / 1000 * rate) % 2 === 0;

  function drawHUD() {
    // Contador de distância no topo, pontos logo abaixo
    text(Math.floor(distance) + " m", W / 2, 8, 24);
    text("Pontos " + score, W / 2, 34, 16);
  }

  // Botão azul com texto pequeno (o texto de 8px fica ilegível com contorno)
  function button(label, cx, y) {
    const s = textSprite(label, 8 * UI_SCALE, "#ffffff", null);
    const w = Math.round((s.width - s.pad * 2) / UI_SCALE) + 14;
    panel(Math.round(cx - w / 2), y - 5, w, 17, "#2f7cf0", "#6fb4ff", "#1748a8");
    text(label, cx, y, 8, { outline: null });
  }

  function drawStartScreen() {
    const t = plane.t;

    // Título com leve flutuação
    const ty = Math.round(H * 0.08 + Math.sin(t * 2) * 2);
    text("Flappy", W / 2, ty, 24, { fill: "#ffd23f" });
    text("Plane", W / 2, ty + 28, 24, { fill: "#ffffff" });

    // Avião grande voando, com rastro de fumaça
    const px = W / 2 + 6;
    const py = Math.round(H * 0.38 + Math.sin(t * 3) * 5);
    for (let i = 0; i < 5; i++) {
      const age = (t * 1.5 + i / 5) % 1;
      const sx = Math.round(px - 26 - age * 50);
      const sy = Math.round(py + 2 - age * 4 + Math.sin(age * 9 + i) * 2);
      const size = Math.max(1, Math.round(5 - age * 4));
      ctx.fillStyle = age < 0.5 ? "#ffffff" : "#d8f1f3";
      ctx.fillRect(sx, sy, size, size);
    }
    drawPlaneAt(px, py, Math.sin(t * 3 + 1) * 0.08, 2);

    // Instruções
    const iw = 140, ih = 40;
    const ix = Math.round((W - iw) / 2), iy = Math.round(H * 0.53);
    panel(ix, iy, iw, ih);
    const bob = Math.round(Math.sin(t * 6));
    ctx.drawImage(ARROW_UP, ix + 12, iy + 9 - bob);
    ctx.drawImage(ARROW_DOWN, ix + 12, iy + 24 + bob);
    text("Segure para subir", ix + 26, iy + 9, 8, { fill: "#5b3a1a", outline: null, align: "left" });
    text("Solte para descer", ix + 26, iy + 24, 8, { fill: "#5b3a1a", outline: null, align: "left" });

    if (blink()) button("Toque para jogar", W / 2, Math.round(iy + ih + 16));

    if (bestDist > 0) {
      text("Recorde: " + bestDist + " m", W / 2, H - GROUND_H + 18, 8, {
        fill: "#5b3a1a",
        outline: null,
      });
    }
  }

  function drawGameOver() {
    const age = (performance.now() - overTime) / 1000;
    dimScreen();

    // Título cai do topo; painel sobe de baixo
    const pTitle = Math.min(age / 0.45, 1);
    const titleY = Math.round(-30 + (H * 0.16 + 30) * easeOutBack(pTitle));
    text("Fim de jogo", W / 2, titleY, 16, { fill: "#ff5a5f" });

    const pPanel = Math.min(Math.max((age - 0.15) / 0.45, 0), 1);
    const bw = 160, bh = 90;
    const bx = Math.round((W - bw) / 2);
    const targetY = Math.round(H * 0.3);
    const by = Math.round(H + (targetY - H) * easeOutBack(pPanel));
    panel(bx, by, bw, bh);

    // Medalha à esquerda
    const label = { fill: "#8a5a2b", outline: null };
    text("Medalha", bx + 30, by + 10, 8, label);
    const medal = MEDALS.find((m) => score >= m.min);
    ctx.drawImage(medal ? medal.sprite : MEDAL_EMPTY, bx + 19, by + 26);
    text(medal ? medal.name : "---", bx + 30, by + 54, 8, label);

    // Divisória
    ctx.fillStyle = "#c9c27a";
    ctx.fillRect(bx + 58, by + 8, 1, bh - 18);

    // Números à direita, com contagem subindo
    const count = Math.min(Math.max((age - 0.5) / 0.8, 0), 1);
    const rx = bx + 66;
    text("Distancia", rx, by + 10, 8, { ...label, align: "left" });
    text(Math.floor(Math.floor(distance) * count) + " m", rx, by + 22, 16, { align: "left" });
    text("Pontos", rx, by + 46, 8, { ...label, align: "left" });
    text(String(Math.floor(score * count)), bx + bw - 10, by + 46, 8, { fill: "#0b2a5b", outline: null, align: "right" });
    text("Recorde", rx, by + 62, 8, { ...label, align: "left" });
    text(bestDist + " m", bx + bw - 10, by + 62, 8, { fill: "#0b2a5b", outline: null, align: "right" });

    // Selo de novo recorde
    if (newRecord && count === 1 && blink(3)) {
      panel(bx + bw - 76, by - 9, 74, 16, "#ff5a5f", "#ff8a8d", "#c43c40");
      text("Novo recorde!", bx + bw - 39, by - 4, 8, { outline: null });
    }

    if (age > 0.9 && blink()) {
      button("Toque para jogar", W / 2, by + bh + 18);
    }
  }

  function drawUI() {
    if (state === STATE.PLAYING) drawHUD();
    else if (state === STATE.READY) drawStartScreen();
    else drawGameOver();
  }

  function draw() {
    drawBackground();
    drawObstacles();
    drawGround();
    drawPlane();
    drawUI();
  }

  // ---------- Loop ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    update(dt);
    draw();
    screen.drawImage(view, 0, 0, canvas.width, canvas.height);
    for (const [s, x, y] of textQueue) screen.drawImage(s, x, y);
    textQueue.length = 0;
    requestAnimationFrame(loop);
  }

  // ---------- Controles: segurar = subir, soltar = descer ----------
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    press();
  });
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      e.preventDefault();
      if (!e.repeat) press();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.code === "ArrowUp") release();
  });
  window.addEventListener("blur", release);
  window.addEventListener("resize", resize);

  reset();
  resize();
  requestAnimationFrame(loop);
})();
