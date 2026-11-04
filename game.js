(() => {
  // O jogo é desenhado num canvas pequeno (view) e ampliado no canvas da
  // página; os textos vão por cima com o dobro da resolução, porque a fonte
  // fica mais nítida em tamanhos maiores
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
  const BASE_INTERVAL = 1.7;  // segundos entre obstáculos no começo
  const MIN_INTERVAL = 0.75;
  const MAX_LIVES = 3;        // batidas até o avião cair
  const INVULN = 1.5;         // segundos piscando (sem dano) depois de uma batida
  const TALK_TIME = 2.4;      // segundos que o balão de fala fica na tela
  const CHUTE_FALL = 50;      // velocidade de descida com paraquedas (px/s)
  const WEDDING_TIME = 45;    // segundos de jogo até chegar no casamento
  const WEDDING_DAY = new Date(2027, 11, 4); // 04.12.27, o dia do casamento
  const VENUE_STOP = 120;     // onde (x na tela) os convidados ficam quando o avião para
  const TREE_GAP = 24;        // distância entre as bananeiras

  const STATE = { READY: 0, PLAYING: 1, OVER: 2, INTRO: 3, CRASH: 4, WEDDING: 5 };

  // Momentos da cena de abertura (em segundos)
  const INTRO = { brideTalk: 1.6, felipeOut: 4.8, felipeTalk: 6, board: 7.6, engine: 9.6, takeoff: 10.4, end: 13 };
  const WALK = 45;            // velocidade dos personagens andando (px/s)

  let state = STATE.READY;
  let plane, obstacles, groundX, clouds, overTime;
  let speed, spawnTimer, elapsed;
  let lives, invuln, talk, popups, jumpers, smoke, smokeTimer, crashT;
  let scroll = 0;             // quanto o chão já andou (px), para bananeiras e casamento
  let wed = null;             // cena do casamento
  let introT = 0;
  let readyAt = -Infinity;    // quando a tela inicial apareceu depois da abertura
  let holding = false;

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

  // Nuvem de chuva (centro em 17,12); as gotas são desenhadas embaixo
  const RAIN_CLOUD = blobSprite(
    34, 22, [[9, 13, 8], [17, 9, 9], [26, 13, 7]],
    (x, y) => (y > 15 ? "#7d8794" : "#9aa4b1"),
    "#4a5363"
  );

  // Banana voadora (centro em 11,6); gira enquanto voa
  const BANANA = spriteFromRows(
    [
      "....................oo",
      "...................obo",
      "..................obbo",
      ".................oyyo.",
      "o...............oyyyo.",
      "oo.............oyyyyo.",
      "oyo..........ooyyyyyo.",
      ".oyoo.....oooyyyyyyo..",
      ".oyyyooooooyyyyyyyyo..",
      "..oylyyyyyyyyyyyyyo...",
      "...oddyyyyyyyyyyddo...",
      "....ooddddddddddoo....",
      "......oooooooooo......",
    ],
    { o: "#5b3a0b", y: "#ffe14d", l: "#fff1a8", d: "#e0b020", b: "#6b4a1a" }
  );

  // Garrafa de espumante pendurada em dois balões de festa (centro em 9,15)
  const BUBBLY = (() => {
    const c = document.createElement("canvas");
    c.width = 18;
    c.height = 30;
    const g = c.getContext("2d");
    g.fillStyle = "#0b2a5b";
    for (const [x, y] of [[6, 12], [6, 13], [7, 14], [7, 15], [8, 16], [12, 12], [11, 13], [11, 14], [10, 15], [9, 16]]) {
      g.fillRect(x, y, 1, 1);
    }
    const shine = (hx, hy, color) => (x, y) => (x === hx && y === hy ? "#ffffff" : color);
    g.drawImage(blobSprite(18, 13, [[12, 6.5, 5]], shine(10, 4, "#ffd23f"), "#8a5a00"), 0, 0);
    g.drawImage(blobSprite(18, 13, [[6, 6, 5.5]], shine(4, 3, "#ff8ab0"), "#8a1d4a"), 0, 0);
    const bottle = spriteFromRows(
      [
        "..ff..", "..ff..", "..gg..", "..gg..", ".gggg.", "oggggo",
        "olllll", "olrrlo", "olllll", "oggggo", "oggggo", ".oooo.",
      ],
      { f: "#ffd23f", g: "#1f6b3a", l: "#f3eeb8", r: "#c43c40", o: "#0b2a2b" }
    );
    g.drawImage(bottle, 6, 17);
    return c;
  })();

  // Bananeira do bananal no chão (base do tronco em 14,27)
  const BANANA_TREE = (() => {
    const c = document.createElement("canvas");
    c.width = 29;
    c.height = 28;
    const g = c.getContext("2d");
    const px = (x, y, color) => {
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    };
    for (let y = 10; y < 28; y++) {
      px(13, y, "#4a6318");
      px(14, y, y % 4 ? "#7da22b" : "#5e7d1e");
      px(15, y, "#4a6318");
    }
    // Folhas: arcos que sobem e caem para os lados
    const leaf = (d, len, up, droop) => {
      let prev = 10;
      for (let i = 0; i <= len; i++) {
        const y = Math.round(10 - up * i + droop * i * i);
        for (let yy = Math.min(y, prev); yy <= Math.max(y, prev); yy++) px(14 + d * i, yy, "#4caf50");
        px(14 + d * i, Math.max(y, prev) + 1, "#2e7d32");
        prev = y;
      }
    };
    for (const d of [-1, 1]) {
      leaf(d, 13, 1.1, 0.11);
      leaf(d, 9, 1.9, 0.17);
    }
    for (let y = 2; y < 11; y++) {
      px(14, y, "#4caf50");
      px(13, y, "#2e7d32");
    }
    // Cacho de bananas
    for (const [x, y] of [[16, 12], [17, 12], [15, 13], [16, 13], [17, 13], [18, 13], [15, 14], [16, 14], [17, 14], [18, 14], [16, 15], [17, 15], [18, 15], [16, 16], [17, 16]]) {
      px(x, y, (x + y) % 3 ? "#ffd23f" : "#c48a00");
    }
    return c;
  })();

  // Convidados do casamento em roupa social, de frente: homens de terno e
  // gravata, mulheres de vestido longo
  const SUIT_ROWS = [
    "..ooooo..",
    ".ohhhhho.",
    "ohhhhhhho",
    "ohsssssho",
    "osessseso",
    "ossssssso",
    ".ossmsso.",
    "...oso...",
    ".ojwrwjo.",
    "ojjwrwjjo",
    "ojjjrjjjo",
    "sjjjjjjjs",
    ".ojjjjjo.",
    ".ojjjjjo.",
    ".ojo.ojo.",
    ".ojo.ojo.",
    ".oko.oko.",
    ".ooo.ooo.",
  ];
  const DRESS_ROWS = [
    "..ooooo..",
    ".ohhhhho.",
    "ohhhhhhho",
    "ohsssssho",
    "ohessseho",
    "ohsssssho",
    "ohssmssho",
    "oh.oso.ho",
    ".osdddso.",
    ".odddddo.",
    "sddddddds",
    ".odDDDdo.",
    ".odddddo.",
    "odddddddo",
    "odddddddo",
    "odddddddo",
    "odddddddo",
    "ooooooooo",
  ];
  const GUEST_PAL = { o: "#0b2a5b", e: "#0b2a5b", m: "#c98d6a", k: "#1a1a1a", w: "#ffffff" };
  const GUESTS = [
    spriteFromRows(DRESS_ROWS, { ...GUEST_PAL, h: "#5b3a1a", s: "#f2c39b", d: "#9b5de5", D: "#ffd23f" }),
    spriteFromRows(SUIT_ROWS, { ...GUEST_PAL, h: "#1a1a1a", s: "#c98d6a", j: "#1b2a4a", r: "#c43c40" }),
    spriteFromRows(DRESS_ROWS, { ...GUEST_PAL, h: "#ffd23f", s: "#f5c9a0", d: "#c43c40", D: "#ffb3c1" }),
    spriteFromRows(SUIT_ROWS, { ...GUEST_PAL, h: "#c4501a", s: "#8a5a3a", j: "#2b2b2b", r: "#9b5de5" }),
    spriteFromRows(DRESS_ROWS, { ...GUEST_PAL, h: "#1a1a1a", s: "#8a5a3a", d: "#2f7cf0", D: "#ffffff" }),
    spriteFromRows(SUIT_ROWS, { ...GUEST_PAL, h: "#7d8794", s: "#f5c9a0", j: "#4a4a4a", r: "#ffd23f" }),
    spriteFromRows(DRESS_ROWS, { ...GUEST_PAL, h: "#c4501a", s: "#f2c39b", d: "#4caf50", D: "#ffd23f" }),
    spriteFromRows(SUIT_ROWS, { ...GUEST_PAL, h: "#5b3a1a", s: "#c98d6a", j: "#1b2a4a", r: "#ff8ab0" }),
  ];

  // Florzinha de 3x3 com folhas (usada no arco e na placa)
  function flower(g, x, y, color) {
    g.fillStyle = "#3f8f2a";
    g.fillRect(x - 2, y + 1, 1, 1);
    g.fillRect(x + 2, y + 1, 1, 1);
    g.fillStyle = color;
    g.fillRect(x - 1, y, 3, 1);
    g.fillRect(x, y - 1, 1, 3);
    g.fillStyle = "#ffd23f";
    g.fillRect(x, y, 1, 1);
  }
  const FLOWERS = ["#ff5a5f", "#ffb3c1", "#ffffff"];

  // Arco do altar, branco e enfeitado de flores (centro em 16, pés em 45)
  const ARCH = (() => {
    const c = makeSprite(32, 46, (x, y) => {
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16);
      const pillar = y >= 16 && (x <= 4 || x >= 27);
      if (y < 16 && d >= 11.5 && d <= 15.5) return d > 14.6 || d < 12.4 ? "#c9d3e0" : "#ffffff";
      if (pillar && x >= 1 && x <= 30) return x === 1 || x === 4 || x === 27 || x === 30 ? "#c9d3e0" : "#ffffff";
      return null;
    });
    const g = c.getContext("2d");
    for (let i = 0; i <= 8; i++) {
      const a = (Math.PI * i) / 8;
      flower(g, Math.round(16 + Math.cos(a) * 13.5), Math.round(16 - Math.sin(a) * 13.5), FLOWERS[i % 3]);
    }
    for (const x of [2, 29]) {
      flower(g, x, 25, FLOWERS[1]);
      flower(g, x, 34, FLOWERS[0]);
      flower(g, x, 43, FLOWERS[2]);
    }
    return c;
  })();

  // "&" desenhado à mão: na fonte Square ele fica parecido com um "B"
  const AMP = spriteFromRows([".oo..", "o..o.", "o.o..", ".o...", "o.o.o", "o..o.", ".oo.o"], { o: "#c43c40" });
  const PETALS = ["#ff5a5f", "#ffb3c1", "#ffffff", "#ffd23f"];

  // Corações das vidas
  const HEART_ROWS = [".oo.oo.", "orrorro", "orWrrro", ".orrro.", "..oro..", "...o..."];
  const HEART = spriteFromRows(HEART_ROWS, { o: "#0b2a5b", r: "#ff5a5f", W: "#ffffff" });
  const LIFE_ROWS = [".oo...oo.", "orro.orro", "oWrrorrro", "oWrrrrrro", ".orrrrro.", "..orrro..", "...oro...", "....o...."];
  const LIFE = spriteFromRows(LIFE_ROWS, { o: "#0b2a5b", r: "#ff5a5f", W: "#ffffff" });
  const LIFE_EMPTY = spriteFromRows(LIFE_ROWS, { o: "#0b2a5b", r: "#7d8794", W: "#7d8794" });

  // Buquê de flores no fim da barra do calendário
  const BOUQUET = (() => {
    const c = document.createElement("canvas");
    c.width = 11;
    c.height = 14;
    const g = c.getContext("2d");
    g.fillStyle = "#2e7d32";
    g.fillRect(4, 7, 3, 7);
    g.fillStyle = "#4caf50";
    g.fillRect(5, 7, 1, 7);
    // Laço
    g.fillStyle = "#ff8ab0";
    g.fillRect(3, 10, 5, 1);
    g.fillRect(2, 9, 1, 3);
    g.fillRect(8, 9, 1, 3);
    flower(g, 3, 5, "#ff5a5f");
    flower(g, 7, 5, "#ffb3c1");
    flower(g, 5, 2, "#ffffff");
    flower(g, 5, 6, "#ff5a5f");
    return c;
  })();

  // Paraquedas listrado (só a cúpula)
  const CHUTE = blobSprite(
    22, 12, [[11, 12, 11]],
    (x) => (Math.floor((x + 1) / 4) % 2 ? "#ffffff" : "#ff5a5f"),
    "#7a1d1d"
  );

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

  // Personagens da abertura, virados para a direita (o desenho é espelhado
  // quando andam para a esquerda)
  const BRIDE = spriteFromRows(
    [
      "......ooooo.....",
      ".....ohhhhho....",
      "...oovhhhhhho...",
      "..ovvhhhhhhhho..",
      "..ovhhhhhssssso.",
      ".ovvhhhhsssseso.",
      ".ovhhhhhssssrso.",
      ".ovhhhhhssssso..",
      ".ovhhhhhossso...",
      ".ovhhhhhoosoo...",
      ".ovhhhhowwwwo...",
      ".ovvhhowwwwwwo..",
      "..ovvowwwwwlFfo.",
      "..ovowwwwwwfFFfo",
      "...oowwwwwwoffo.",
      "....owwwwwwwoo..",
      "...ogwwwwwwwo...",
      "...ogwwwwwwwwo..",
      "..ogwwwwwwwwwo..",
      "..ogwwwwwwwwwwo.",
      ".ogwwwwwwwwwwwo.",
      ".oggwwwwwwwwggo.",
      "..oooooooooooo..",
    ],
    {
      o: "#0b2a5b", h: "#ffd23f", v: "#eef6ff", s: "#f5c9a0", e: "#0b2a5b", r: "#ff8a8d",
      w: "#ffffff", g: "#c9d3e0", l: "#4caf50", f: "#ff5a5f", F: "#ffb3c1",
    }
  );

  const PILOT_TOP = [
    "...oooooo....",
    "..oCCCCCCo...",
    ".oCCCCCCCCo..",
    ".occccyycco..",
    ".oooooooooooo",
    ".ohhsssssso..",
    ".ohssskkkkko.",
    ".ohsssskkkso.",
    "..osssssssso.",
    "..ossssmmso..",
    "...oossssoo..",
    "..ojjjtTtjjo.",
    ".ojjjjtTjjjjo",
    ".ojjyjjTjjjjo",
    ".ojjjjjTjjjjo",
    ".osojjjjjjoso",
    "..okkkkkkkko.",
    "..opppppppo..",
  ];
  const PILOT_PAL = {
    o: "#0b2a5b", C: "#ffffff", c: "#1b2a4a", y: "#ffd23f", s: "#f2c39b", h: "#5b3a1a",
    k: "#1a1a1a", m: "#c98d6a", j: "#22355e", t: "#ffffff", T: "#1a1a1a", p: "#1b2a4a", b: "#111111",
  };
  // Dois quadros: parado e passo
  const PILOT = [
    spriteFromRows([...PILOT_TOP, "..oppppoppo..", "..oppo.oppo..", "..oppo.oppo..", "..obbbo.obbbo", "..ooooo.ooooo"], PILOT_PAL),
    spriteFromRows([...PILOT_TOP, "..oppo.oppo..", ".oppo...oppo.", "oppo.....oppo", "obbbo....obbbo", "ooooo....ooooo"], PILOT_PAL),
  ];

  // ---------- Texto com a fonte Square ----------
  // A fonte é desenhada num canvas à parte e depois "binarizada" (sem
  // antialiasing), ganhando um contorno de 1 pixel e uma sombra embaixo.
  const font = new FontFace("Square", "url(fonts/Square.ttf)");
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

    // px = espessura do contorno, que cresce junto com o tamanho do texto
    const px = Math.max(1, Math.round(size / 16));
    const pad = px * 3;
    const fontCss = `${size}px Square, monospace`;
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
    groundX = 0;
    speed = BASE_SPEED;
    spawnTimer = 0;
    elapsed = 0;
    lives = MAX_LIVES;
    invuln = 0;
    talk = null;
    popups = [];
    jumpers = [];
    smoke = [];
    smokeTimer = 0;
    crashT = 0;
    scroll = 0;
    wed = null;
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

  // Objetos ruins do céu (r = raio de colisão); banana aparece em dobro
  const TYPES = [
    { kind: "balloon", r: 11 },
    { kind: "bird", r: 7 },
    { kind: "rain", r: 14 },
    { kind: "banana", r: 9 },
    { kind: "banana", r: 9 },
  ];
  // Objeto bom: garrafa de espumante nos balões
  const BUBBLY_TYPE = { kind: "bubbly", r: 10 };

  // extra: um segundo objeto ruim no mesmo momento, longe do anterior
  function spawnObstacle(extra = false) {
    const type = !extra && Math.random() < 0.2 ? BUBBLY_TYPE : TYPES[Math.floor(Math.random() * TYPES.length)];
    const top = 15 + type.r;
    const bottom = H - GROUND_H - type.r - 18;
    const prev = obstacles[obstacles.length - 1];
    let y = top + Math.random() * (bottom - top);
    for (let i = 0; extra && prev && i < 10 && Math.abs(y - prev.baseY) < 60; i++) {
      y = top + Math.random() * (bottom - top);
    }
    obstacles.push({
      ...type,
      x: W + type.r + 10 + (extra ? 25 : 0),
      y,
      baseY: y,
      t: Math.random() * Math.PI * 2,
    });
  }

  function press() {
    holding = true;
    // A abertura não pode ser pulada
    if (state === STATE.READY) {
      // Só começa depois que as instruções terminam de aparecer
      if (performance.now() - readyAt < 1300) return;
      state = STATE.PLAYING;
    } else if (state === STATE.OVER && performance.now() - overTime > 900) {
      reset();
    } else if (state === STATE.WEDDING && wed.stopT !== null && wed.t - wed.stopT > PARTY.button) {
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
    if (navigator.vibrate) navigator.vibrate(120);
  }

  // Balão de fala que acompanha o avião
  function say(lines) {
    talk = { lines, t: 0 };
  }

  // Batida em algo ruim (ou no chão): perde uma vida e pisca por um tempo
  function hurt(kind) {
    if (invuln > 0) return;
    lives--;
    invuln = INVULN;
    if (kind === "banana") say(["Felipe, eu odeio banana!"]);
    if (kind === "rain") say(["Meu cabelo vai molhar,", "Felipe!"]);
    if (navigator.vibrate) navigator.vibrate(lives > 0 ? 60 : 200);
    if (lives <= 0) crash();
  }

  // Espumante: ganha uma vida (até o máximo)
  function collect(o) {
    o.dead = true;
    if (lives < MAX_LIVES) {
      lives++;
      popups.push({ x: o.x, y: o.y, t: 0, label: "+1 vida" });
    }
    say(["Caves do Sul,", "que delícia!"]);
  }

  // Sem vidas: o avião cai e os dois saltam de paraquedas
  function crash() {
    state = STATE.CRASH;
    crashT = 0;
    holding = false;
    const feet = plane.y + 10;
    jumpers = [
      { sprite: BRIDE, x: plane.x - 4, y: feet, vx: -22, vy: -150, age: 0, landedAt: null },
      { sprite: PILOT[0], x: plane.x + 4, y: feet, vx: 26, vy: -170, age: 0, landedAt: null },
    ];
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

    if (state === STATE.INTRO) {
      introT += dt;
      if (introT >= INTRO.end) {
        state = STATE.READY;
        readyAt = performance.now();
      }
      return;
    }

    if (state === STATE.READY) {
      plane.y = H * 0.42;
      plane.angle = 0;
      groundX = (groundX - speed * dt) % 8;
      scroll += speed * dt;
      return;
    }

    if (state === STATE.CRASH || state === STATE.OVER) return updateCrash(dt);
    if (state === STATE.WEDDING) return updateWedding(dt);

    // Física do avião: acelera suavemente para cima ou para baixo
    if (holding) {
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
      // Bater no chão também conta como batida; o avião quica para cima
      plane.y = floor - 6;
      plane.vy = -MAX_RISE * 0.8;
      hurt("ground");
      if (state !== STATE.PLAYING) return;
    }

    invuln = Math.max(0, invuln - dt);
    tickEffects(dt);

    // Dificuldade sobe aos poucos
    elapsed += dt;
    speed = Math.min(BASE_SPEED + elapsed * 1.05, MAX_SPEED);
    const interval = Math.max(BASE_INTERVAL - elapsed * 0.025, MIN_INTERVAL);

    // Sobreviver WEDDING_TIME segundos leva ao casamento
    groundX = (groundX - speed * dt) % 8;
    scroll += speed * dt;
    if (elapsed >= WEDDING_TIME) return startWedding();

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObstacle();
      // Com o tempo, às vezes vêm dois objetos ruins juntos
      if (Math.random() < Math.min(Math.max((elapsed - 10) / 45, 0), 0.4)) spawnObstacle(true);
      spawnTimer = interval;
    }

    for (const o of obstacles) {
      o.t += dt;
      o.x -= (o.kind === "bird" ? speed * 1.25 : speed) * dt;
      if (o.kind === "bird") o.y = o.baseY + Math.sin(o.t * 3) * 12;
      if (o.kind === "banana") o.x -= speed * 0.15 * dt;
      if (o.kind === "banana") o.y = o.baseY + Math.sin(o.t * 4) * 5;
      if (o.kind === "balloon" || o.kind === "bubbly") o.y = o.baseY + Math.sin(o.t * 1.5) * 6;
      if (hits(o)) {
        if (o.kind === "bubbly") {
          collect(o);
        } else if (invuln <= 0) {
          o.dead = true;
          hurt(o.kind);
        }
      }
    }

    obstacles = obstacles.filter((o) => !o.dead && o.x > -o.r * 2);
  }

  function tickEffects(dt) {
    // Na queda, a fala da noiva fica até ela pousar
    if (talk && (talk.t += dt) > TALK_TIME && state !== STATE.CRASH) talk = null;
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.8);
  }

  function updateCrash(dt) {
    crashT += dt;
    tickEffects(dt);

    // O cenário vai parando
    speed = Math.max(0, speed - 60 * dt);
    groundX = (groundX - speed * dt) % 8;
    scroll += speed * dt;
    for (const o of obstacles) o.x -= speed * dt;

    // Avião rodopia até o chão
    const floor = H - GROUND_H;
    if (!plane.down) {
      plane.vy = Math.min(plane.vy + GRAVITY * dt, 220);
      plane.y += plane.vy * dt;
      plane.x += 25 * dt;
      plane.angle += 5 * dt;
      if (plane.y + 4 >= floor) {
        plane.y = floor - 4;
        plane.down = true;
        plane.angle = 0.35;
        if (navigator.vibrate) navigator.vibrate(150);
      }
    }

    // Fumaça saindo do avião
    smokeTimer -= dt;
    if (smokeTimer <= 0) {
      smoke.push({ x: plane.x - 6, y: plane.y - 2, t: 0 });
      smokeTimer = plane.down ? 0.18 : 0.04;
    }
    for (const p of smoke) {
      p.t += dt;
      p.y -= 14 * dt;
      p.x -= (speed * 0.5 + 4) * dt;
    }
    smoke = smoke.filter((p) => p.t < 1.2);

    // Passageiros: queda livre rápida, abre o paraquedas e desce devagar
    for (const j of jumpers) {
      if (j.landedAt !== null) continue;
      j.age += dt;
      if (j.age < 0.5) j.vy += 300 * dt;
      else j.vy += (CHUTE_FALL - j.vy) * Math.min(dt * 4, 1);
      j.vx *= 1 - Math.min(dt * 1.5, 1);
      j.x = Math.min(Math.max(j.x + j.vx * dt, 12), W - 12);
      j.y += j.vy * dt;
      // Não deixa o paraquedas sair por cima da tela
      const minY = j.sprite.height + 18;
      if (j.y < minY) {
        j.y = minY;
        j.vy = Math.max(j.vy, 0);
      }
      if (j.vy > 0 && j.y >= floor + 2) {
        j.y = floor + 2;
        j.landedAt = crashT;
        // A noiva vai reclamar do bananal; o balão do avião some
        if (j === jumpers[0]) talk = null;
      }
    }

    // Fim de jogo quando todos estão salvos no chão e a noiva terminou de escrever
    const bride = jumpers[0];
    const landed = jumpers.every((j) => j.landedAt !== null);
    if (
      state === STATE.CRASH && landed && plane.down &&
      crashT - Math.max(...jumpers.map((j) => j.landedAt)) > 0.8 && crashT - bride.landedAt > 1.6
    ) {
      gameOver();
    }
  }

  // Chegou no casamento: o local aparece pela direita e o avião pousa sozinho
  function startWedding() {
    elapsed = WEDDING_TIME;
    state = STATE.WEDDING;
    holding = false;
    invuln = 0;
    const venue = scroll + W + 200;
    wed = {
      venue, dist: venue - VENUE_STOP - scroll, v0: speed, t: 0, stopT: null,
      petals: [], petalTimer: 0, hearts: [], heartTimer: 0,
      treesEnd: scroll + W + 10, // o bananal acaba aqui: o final fica sem bananeiras
    };
  }

  // Momentos da festa, em segundos depois que o avião para
  const PARTY = { out: 0.6, groomDelay: 0.3, hearts: 2.9, cheer: 3.4, toast: 4.2, button: 6 };
  // Posições em relação ao centro do local (vx): convidados enchendo o
  // caminho até o altar (e dois do outro lado); a placa fica atrás do altar
  const GUEST_DX = [-54, -45, -36, -27, -18, -9, 34, 44];
  const ALTAR_DX = 10;
  const GROOM_DX = ALTAR_DX - 7, BRIDE_DX = ALTAR_DX + 7;
  const CHEER_GUEST = 2;

  function updateWedding(dt) {
    wed.t += dt;
    tickEffects(dt);
    const floor = H - GROUND_H;

    if (wed.stopT === null) {
      // Freia de forma que o local do casamento pare em VENUE_STOP
      const rem = Math.max(wed.venue - VENUE_STOP - scroll, 0);
      speed = Math.max(wed.v0 * Math.sqrt(rem / wed.dist), 6);
      const step = Math.min(speed * dt, rem);
      scroll += step;
      groundX = (groundX - step) % 8;
      for (const o of obstacles) o.x -= step;
      obstacles = obstacles.filter((o) => o.x > -o.r * 2);

      // Piloto automático: desce suave até as rodas tocarem o chão
      const target = floor - 8;
      plane.vy = Math.min(Math.max((target - plane.y) * 1.6, -MAX_RISE), MAX_FALL);
      plane.y += plane.vy * dt;
      plane.angle += ((plane.vy / MAX_FALL) * 0.3 - plane.angle) * Math.min(dt * 6, 1);
      if (rem <= 0) {
        wed.stopT = wed.t;
        speed = 0;
        plane.y = target;
        plane.angle = 0;
      }
      return;
    }

    // Com os noivos no altar, os convidados jogam flores neles
    const s = wed.t - wed.stopT;
    if (s > PARTY.cheer) {
      wed.petalTimer -= dt;
      if (wed.petalTimer <= 0) {
        wed.petalTimer = 0.05;
        // Cada convidado joga na direção do altar
        const dx = GUEST_DX[Math.floor(Math.random() * GUEST_DX.length)];
        const dir = dx < ALTAR_DX ? 1 : -1;
        wed.petals.push({
          x: wed.venue - scroll + dx, y: floor - 12,
          vx: dir * (15 + Math.random() * 45), vy: -70 - Math.random() * 50,
          color: PETALS[Math.floor(Math.random() * PETALS.length)], down: false,
        });
      }
    }
    for (const p of wed.petals) {
      if (p.down) continue;
      p.vy = Math.min(p.vy + 140 * dt, 40);
      p.x += p.vx * dt + Math.sin(wed.t * 7 + p.vx) * 0.3;
      p.y += p.vy * dt;
      if (p.y >= floor + 1) {
        p.y = floor + 1 + Math.floor(Math.random() * 4);
        p.down = true;
      }
    }
    if (wed.petals.length > 260) wed.petals.splice(0, wed.petals.length - 260);

    // Corações subindo dos noivos no altar
    if (s > PARTY.hearts) {
      wed.heartTimer -= dt;
      if (wed.heartTimer <= 0) {
        wed.heartTimer = 0.3;
        const side = wed.hearts.length % 2 ? BRIDE_DX : GROOM_DX;
        wed.hearts.push({ x: wed.venue - scroll + side, y: floor - 24, t: 0, phase: Math.random() * 6 });
      }
    }
    for (const h of wed.hearts) {
      h.t += dt;
      h.y -= 18 * dt;
    }
    wed.hearts = wed.hearts.filter((h) => h.t < 1.4);
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
      } else if (o.kind === "banana") {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-o.t * 6);
        ctx.drawImage(BANANA, -11, -6);
        ctx.restore();
      } else if (o.kind === "bubbly") {
        ctx.drawImage(BUBBLY, x - 9, y - 15);
      } else {
        // Gotas caindo em colunas, cada uma num ritmo
        ctx.fillStyle = "#6fb4ff";
        for (let i = 0; i < 6; i++) {
          const dy = (o.t * 40 + i * 7) % 16;
          ctx.fillRect(x - 13 + i * 5, Math.round(y + 7 + dy), 1, 3);
        }
        ctx.drawImage(RAIN_CLOUD, x - 17, y - 12);
      }
    }
  }

  // Bananal ao longo do chão; acaba antes do local do casamento
  function drawBananal() {
    const floor = H - GROUND_H;
    const end = wed ? wed.treesEnd : Infinity;
    for (let k = Math.floor((scroll - 20) / TREE_GAP); k * TREE_GAP - scroll < W + 20; k++) {
      const wx = k * TREE_GAP;
      if (wx > end) break;
      const x = Math.round(wx - scroll);
      const sink = (k * 7) % 3;
      if (k % 2) {
        ctx.save();
        ctx.translate(x + 15, floor - 25 + sink);
        ctx.scale(-1, 1);
        ctx.drawImage(BANANA_TREE, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(BANANA_TREE, x - 14, floor - 25 + sink);
      }
    }
  }

  // Local do casamento: tapete vermelho, placa atrás do altar e convidados
  function drawVenue() {
    const floor = H - GROUND_H;
    const vx = Math.round(wed.venue - scroll);
    if (vx > W + 120) return;
    const party = wed.stopT !== null && wed.t - wed.stopT > PARTY.cheer;

    ctx.fillStyle = "#c43c40";
    ctx.fillRect(vx - 62, floor + 1, 90, 3);
    ctx.fillStyle = "#ff5a5f";
    ctx.fillRect(vx - 62, floor + 1, 90, 1);

    drawSign(vx + ALTAR_DX, floor - 74, floor);
    ctx.drawImage(ARCH, vx + ALTAR_DX - 16, floor + 2 - 46);

    // Convidados pulando de alegria na festa
    GUESTS.forEach((g, i) => {
      const hop = party ? Math.round(Math.max(0, Math.sin(wed.t * 8 + i * 1.7)) * 3) : 0;
      drawPerson(g, vx + GUEST_DX[i], floor + 2 - hop, false);
    });
  }

  // Placa dos noivos: moldura dourada, fundo creme, flores e um coração
  // Fica sobre dois postes dourados que descem até o chão (base)
  function drawSign(cx, sy, base) {
    const width = (str) => {
      const ts = textSprite(str, 8 * UI_SCALE, "#c43c40", null);
      return Math.round((ts.width - ts.pad * 2) / UI_SCALE);
    };
    const left = width("Sami"), right = width("Felipe");
    const inner = left + 4 + AMP.width + 4 + right;
    const w = inner + 16, h = 22;
    const x = Math.round(cx - w / 2);

    ctx.fillStyle = "#c48a00";
    ctx.fillRect(Math.round(cx) - 12, sy + h, 2, base - sy - h);
    ctx.fillRect(Math.round(cx) + 11, sy + h, 2, base - sy - h);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(x + 2, sy + h, w - 2, 2);
    ctx.fillStyle = "#8a5a00";
    ctx.fillRect(x + 1, sy, w - 2, h);
    ctx.fillRect(x, sy + 1, w, h - 2);
    ctx.fillStyle = "#ffd23f";
    ctx.fillRect(x + 1, sy + 1, w - 2, h - 2);
    ctx.fillStyle = "#c48a00";
    ctx.fillRect(x + 2, sy + 2, w - 4, h - 4);
    ctx.fillStyle = "#fff8e7";
    ctx.fillRect(x + 3, sy + 3, w - 6, h - 6);
    // Linha fina dourada por dentro
    ctx.fillStyle = "#f3d27a";
    ctx.fillRect(x + 5, sy + 5, w - 10, 1);
    ctx.fillRect(x + 5, sy + h - 6, w - 10, 1);

    const lx = Math.round(cx - inner / 2);
    const red = { fill: "#c43c40", outline: null, align: "left" };
    text("Sami", lx, sy + 8, 8, red);
    ctx.drawImage(AMP, lx + left + 4, sy + 8);
    text("Felipe", lx + left + 4 + AMP.width + 4, sy + 8, 8, red);

    // Flores nos cantos e coração no topo
    flower(ctx, x + 2, sy + 2, FLOWERS[0]);
    flower(ctx, x + 5, sy + 1, FLOWERS[1]);
    flower(ctx, x + w - 3, sy + 2, FLOWERS[0]);
    flower(ctx, x + w - 6, sy + 1, FLOWERS[1]);
    ctx.drawImage(HEART, Math.round(cx) - 3, sy - 3);
  }

  // Noivos andam do avião até o altar e ficam de frente um para o outro
  function drawCouple() {
    const s = wed.t - wed.stopT;
    const floor = H - GROUND_H;
    const vx = Math.round(wed.venue - scroll);
    const step = Math.floor(wed.t * 8) % 2;
    const start = plane.x + 4;
    const at = (delay, spot) => {
      const walked = (s - PARTY.out - delay) * WALK;
      return walked < 0 ? null : { x: Math.min(start + walked, spot), walking: start + walked < spot };
    };
    const groom = at(PARTY.groomDelay, vx + GROOM_DX);
    const bride = at(0, vx + BRIDE_DX);
    if (groom) drawPerson(PILOT[groom.walking ? step : 0], groom.x, floor + 2, false);
    if (bride) drawPerson(BRIDE, bride.x, floor + 2 - (bride.walking ? step : 0), !bride.walking);
    for (const p of wed.petals) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.down ? 2 : 1 + (Math.floor(wed.t * 10 + p.vx) % 2), 1);
    }
    for (const h of wed.hearts) {
      ctx.globalAlpha = Math.min(1, (1.4 - h.t) / 0.5);
      ctx.drawImage(HEART, Math.round(h.x - 3 + Math.sin(h.t * 4 + h.phase) * 3), Math.round(h.y));
      ctx.globalAlpha = 1;
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

  // Avião com hélice; scale > 1 amplia mantendo os pixels (tela inicial).
  // spin = 0 deixa a hélice parada; gear desenha as rodas (avião no chão).
  function drawPlaneAt(x, y, angle, scale = 1, opts = {}) {
    // Hélice gira mais rápido quando está subindo
    const { spin = holding && state === STATE.PLAYING ? 60 : 30, gear = false } = opts;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(angle);
    ctx.scale(scale, scale);

    if (gear) {
      ctx.fillStyle = "#0b2a5b";
      ctx.fillRect(3, 3, 1, 3);
      ctx.fillRect(-9, 3, 1, 2);
      ctx.fillStyle = "#222222";
      ctx.fillRect(2, 5, 3, 3);
      ctx.fillRect(-10, 5, 2, 2);
      ctx.fillStyle = "#9a9a9a";
      ctx.fillRect(3, 6, 1, 1);
    }
    ctx.drawImage(PLANE, -12, -6);

    const blade = spin ? Math.round(Math.abs(Math.sin(plane.t * spin)) * 5) + 1 : 5;
    ctx.fillStyle = "#555555";
    ctx.fillRect(11, -blade, 1, blade * 2);
    ctx.fillStyle = "#0b2a5b";
    ctx.fillRect(10, -1, 1, 2);

    ctx.restore();
  }

  function pixelLine(x0, y0, x1, y1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
    }
  }

  // Passageiro pendurado no paraquedas (y = pés); no chão, o paraquedas fica murcho ao lado
  function drawJumper(j) {
    const h = j.sprite.height;
    if (j.landedAt !== null) {
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = Math.floor(i / 3) % 2 ? "#ffffff" : "#ff5a5f";
        ctx.fillRect(Math.round(j.x) - 22 + i, Math.round(j.y) - 3, 1, 3);
      }
      drawPerson(j.sprite, j.x, j.y, false);
      return;
    }
    const x = Math.round(j.x + (j.age > 0.5 ? Math.sin(j.age * 2.5) * 3 : 0));
    const top = Math.round(j.y - h);
    if (j.age > 0.5) {
      const dome = top - 16;
      ctx.fillStyle = "#0b2a5b";
      pixelLine(x - 10, dome + 11, x - 4, top + 10);
      pixelLine(x + 10, dome + 11, x + 4, top + 10);
      ctx.drawImage(CHUTE, x - 11, dome);
    }
    drawPerson(j.sprite, x, j.y, false);
  }

  function drawSmoke() {
    for (const p of smoke) {
      const size = Math.round(2 + p.t * 4);
      ctx.fillStyle = p.t < 0.4 ? "#5a6275" : "#8a92a5";
      ctx.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
    }
  }

  function drawPlane() {
    if (state === STATE.READY || state === STATE.INTRO) return;
    drawSmoke();
    // Pisca enquanto está invencível depois de uma batida
    const hidden = state === STATE.PLAYING && invuln > 0 && Math.floor(invuln * 12) % 2;
    let opts = plane.down ? { spin: 0 } : {};
    if (state === STATE.WEDDING) opts = { spin: wed.stopT === null ? 30 : 0, gear: plane.y > H - GROUND_H - 22 };
    if (!hidden) drawPlaneAt(plane.x, plane.y, plane.angle, 1, opts);
    for (const j of jumpers) drawJumper(j);
    if (state === STATE.WEDDING && wed.stopT !== null) drawCouple();
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

  const easeOutBack = (p) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
  const blink = (rate = 2) => Math.floor(performance.now() / 1000 * rate) % 2 === 0;

  // Calendário: os dias vão de hoje até o casamento conforme o jogo avança
  // (se faltar menos de um mês, começa um ano antes)
  const DAY = 864e5;
  const CAL_START = (() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (WEDDING_DAY - today >= 30 * DAY) return today;
    return new Date(WEDDING_DAY.getFullYear() - 1, WEDDING_DAY.getMonth(), WEDDING_DAY.getDate());
  })();
  const CAL_DAYS = Math.round((WEDDING_DAY - CAL_START) / DAY);

  function calendarDate(p) {
    const d = new Date(CAL_START.getFullYear(), CAL_START.getMonth(), CAL_START.getDate() + Math.round(p * CAL_DAYS));
    const two = (n) => String(n).padStart(2, "0");
    return two(d.getDate()) + "." + two(d.getMonth() + 1) + "." + two(d.getFullYear() % 100);
  }

  function drawHUD() {
    // Data no topo e a barra do calendário crescendo até o casamento
    const p = Math.min(elapsed / WEDDING_TIME, 1);
    text(calendarDate(p), W / 2, 6, 16);
    const x0 = 22, x1 = W - 30, by = 27;
    ctx.fillStyle = "#0b2a5b";
    ctx.fillRect(x0 - 1, by - 1, x1 - x0 + 2, 7);
    ctx.fillStyle = "#fff8e7";
    ctx.fillRect(x0, by, x1 - x0, 5);
    ctx.fillStyle = "#4caf50";
    ctx.fillRect(x0, by, Math.round((x1 - x0) * p), 5);
    ctx.fillStyle = "#8bd17c";
    ctx.fillRect(x0, by, Math.round((x1 - x0) * p), 1);
    ctx.drawImage(BOUQUET, x1 + 3, by - 5);
    for (let i = 0; i < MAX_LIVES; i++) {
      ctx.drawImage(i < lives ? LIFE : LIFE_EMPTY, 4 + i * 11, 4);
    }
    for (const p of popups) {
      text(p.label, p.x, p.y - 10 - p.t * 20, 8, { fill: "#ffd23f" });
    }

    if (talk) {
      // Balão em cima do avião ou, na queda, da noiva no paraquedas; se não
      // couber abaixo do placar, vai para baixo
      const bride = jumpers[0];
      const h = talk.lines.length * 12 + 7;
      let x = plane.x, top = plane.y - 12, bottom = plane.y + 12;
      if (state === STATE.CRASH && bride) {
        x = Math.round(bride.x);
        top = bride.y - BRIDE.height - (bride.age > 0.5 ? 20 : 4);
        bottom = bride.y + 4;
      }
      const below = top - h < 52;
      speech(talk.lines, x + 20, below ? bottom : top, x + 4, talk.t * 30, below);
    }
  }

  // Botão azul com texto pequeno (o texto de 8px fica ilegível com contorno)
  function button(label, cx, y, size = 8) {
    const s = textSprite(label, size * UI_SCALE, "#ffffff", null);
    const w = Math.round((s.width - s.pad * 2) / UI_SCALE) + 14;
    const pad = Math.round(size * 0.6);
    panel(Math.round(cx - w / 2), y - pad, w, size + pad * 2 + 1, "#2f7cf0", "#6fb4ff", "#1748a8");
    text(label, cx, y, size, { outline: null });
  }

  // ---------- Abertura ----------
  // Balão de fala com o texto aparecendo letra por letra (chars = letras visíveis).
  // Normalmente fica acima de anchorY com a ponta para baixo; com below, fica
  // abaixo de anchorY com a ponta para cima.
  function speech(lines, cx, anchorY, tailX, chars, below = false) {
    const widths = lines.map((l) => {
      const s = textSprite(l, 8 * UI_SCALE, "#0b2a5b", null);
      return (s.width - s.pad * 2) / UI_SCALE;
    });
    const w = Math.round(Math.max(...widths)) + 12;
    const h = lines.length * 12 + 7;
    const x = Math.round(Math.min(Math.max(cx - w / 2, 3), W - 3 - w));
    const y = Math.round(below ? anchorY : anchorY - h);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(x + 2, y + h, w - 2, 2);
    ctx.fillStyle = "#0b2a5b";
    ctx.fillRect(x + 1, y, w - 2, h);
    ctx.fillRect(x, y + 1, w, h - 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

    // Ponta do balão apontando para quem fala
    const tx = Math.round(Math.min(Math.max(tailX - 2, x + 4), x + w - 8));
    for (let i = 0; i < 4; i++) {
      const ry = below ? y - i : y + h - 1 + i;
      ctx.fillStyle = "#0b2a5b";
      ctx.fillRect(tx - 1, ry, 6 - i * 2 + 1, 1);
      ctx.fillStyle = "#ffffff";
      if (i < 3) ctx.fillRect(tx, ry, 5 - i * 2, 1);
    }

    let left = chars;
    lines.forEach((line, i) => {
      const shown = line.slice(0, Math.max(0, Math.floor(left)));
      left -= line.length;
      if (shown) {
        text(shown, x + (w - widths[i]) / 2, y + 5 + i * 12, 8, { fill: "#0b2a5b", outline: null, align: "left" });
      }
    });
  }

  function drawPerson(sprite, x, feet, faceLeft) {
    const left = Math.round(x - sprite.width / 2);
    const top = Math.round(feet - sprite.height);
    if (!faceLeft) return ctx.drawImage(sprite, left, top);
    ctx.save();
    ctx.translate(left + sprite.width, top);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite, 0, 0);
    ctx.restore();
  }

  function drawIntro() {
    const t = introT;
    const ground = H - GROUND_H;
    // Avião estacionado (escala 3), porta e escadinha logo à direita da asa
    const px = 42, py = ground - 23;
    const doorX = px + 9, stairX = px + 26;
    const feetAt = (x) =>
      x >= stairX ? ground + 2 : py + 9 + ((x - doorX) / (stairX - doorX)) * (ground + 2 - (py + 9));

    // Avião: parado, liga o motor, corre na pista e decola
    let ax = px, ay = py, angle = 0, gear = true;
    if (t >= INTRO.takeoff) {
      const s = t - INTRO.takeoff;
      const lift = Math.max(0, s - 1.2);
      ax = px + 30 * s * s;
      ay = py - 55 * lift * lift;
      angle = -Math.min(0.45, lift * 0.6);
      gear = lift < 0.4;
      // Poeira saindo das rodas enquanto corre
      if (lift === 0) {
        ctx.fillStyle = "#f3eeb8";
        for (let i = 0; i < 4; i++) {
          const age = (s * 3 + i / 4) % 1;
          const size = Math.max(1, Math.round(4 - age * 3));
          ctx.fillRect(Math.round(ax - 30 - age * 25), Math.round(ground - age * 6), size, size);
        }
      }
    }
    drawPlaneAt(ax, ay, angle, 3, { spin: t >= INTRO.engine ? 30 : 0, gear });

    if (t < INTRO.engine) {
      // Porta aberta enquanto alguém sai ou entra
      const open = (t >= INTRO.felipeOut && t < INTRO.felipeOut + 0.5) || t >= INTRO.board;
      ctx.fillStyle = "#0b2a5b";
      if (open) {
        ctx.fillRect(px + 6, py - 3, 6, 12);
      } else {
        ctx.fillRect(px + 6, py - 3, 6, 1);
        ctx.fillRect(px + 6, py - 3, 1, 12);
        ctx.fillRect(px + 11, py - 3, 1, 12);
      }
      // Escadinha
      for (let x = doorX + 3; x <= stairX; x++) {
        const y = Math.round(feetAt(x));
        ctx.fillStyle = "#7d8794";
        ctx.fillRect(x, y, 1, 2);
        if ((x - doorX) % 4 === 0) {
          ctx.fillStyle = "#c0c7d0";
          ctx.fillRect(x - 3, y, 4, 1);
        }
      }
    }

    // Noiva: chega pela direita, fala e depois embarca
    const brideStop = 136;
    let bx = brideStop, brideWalk = false;
    if (t < INTRO.brideTalk) {
      bx = W + 12 + (brideStop - W - 12) * (t / INTRO.brideTalk);
      brideWalk = true;
    } else if (t >= INTRO.board) {
      bx = brideStop - (t - INTRO.board) * WALK;
      brideWalk = true;
    }

    // Felipe: sai do avião, fala e volta para o avião
    const felipeStop = 92;
    const outEnd = INTRO.felipeOut + (felipeStop - doorX) / WALK;
    let fx = null, felipeLeft = false, felipeWalk = false;
    if (t >= INTRO.felipeOut && t < outEnd) {
      fx = doorX + (t - INTRO.felipeOut) * WALK;
      felipeWalk = true;
    } else if (t >= outEnd && t < INTRO.board) {
      fx = felipeStop;
    } else if (t >= INTRO.board) {
      fx = felipeStop - (t - INTRO.board) * WALK;
      felipeLeft = felipeWalk = true;
    }

    const step = Math.floor(t * 8) % 2;
    if (bx > doorX) {
      drawPerson(BRIDE, bx, feetAt(bx) - (brideWalk ? step : 0), true);
    }
    if (fx !== null && fx > doorX) {
      drawPerson(PILOT[felipeWalk ? step : 0], fx, feetAt(fx), felipeLeft);
    }

    if (t >= INTRO.brideTalk && t < INTRO.felipeOut) {
      const head = ground + 2 - BRIDE.height;
      speech(["Felipe, estou atrasada", "para o nosso casamento!"], bx, head - 5, bx - 3, (t - INTRO.brideTalk) * 30);
    }
    if (fx !== null && t >= INTRO.felipeTalk && t < INTRO.board) {
      const head = ground + 2 - PILOT[0].height;
      speech(["Vamos!"], fx, head - 5, fx + 2, (t - INTRO.felipeTalk) * 15);
    }
  }

  function drawStartScreen() {
    const t = plane.t;
    // Depois da abertura, avião, título e instruções entram aos poucos
    const age = (performance.now() - readyAt) / 1000;
    const enter = (delay) => easeOutBack(Math.min(Math.max((age - delay) / 0.5, 0), 1));

    // Título com leve flutuação
    const ty = Math.round(H * 0.08 + Math.sin(t * 2) * 2 - (1 - enter(0.5)) * 70);
    text("Missão", W / 2, ty, 24, { fill: "#ffd23f" });
    text("Casamento", W / 2, ty + 28, 24, { fill: "#ffffff" });

    // Avião grande voando, com rastro de fumaça
    const fly = 1 - (1 - Math.min(age / 0.9, 1)) ** 3;
    const px = -30 + (W / 2 + 36) * fly;
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
    const ix = Math.round((W - iw) / 2);
    const iy = Math.round(H * 0.53 + (1 - enter(0.8)) * H * 0.5);
    panel(ix, iy, iw, ih);
    const bob = Math.round(Math.sin(t * 6));
    ctx.drawImage(ARROW_UP, ix + 12, iy + 9 - bob);
    ctx.drawImage(ARROW_DOWN, ix + 12, iy + 24 + bob);
    text("Segure para subir", ix + 26, iy + 9, 8, { fill: "#5b3a1a", outline: null, align: "left" });
    text("Solte para descer", ix + 26, iy + 24, 8, { fill: "#5b3a1a", outline: null, align: "left" });

    if (age > 1.3 && blink()) button("Toque para jogar", W / 2, Math.round(iy + ih + 16));
  }

  // Fim de jogo: a fala da noiva continua e o aviso fica no meio da tela
  function drawGameOver() {
    drawBrideComplaint();
    const age = (performance.now() - overTime) / 1000;
    if (age > 0.5) button("Tentar de novo", W / 2, Math.round(H / 2 - 4));
  }

  // A noiva, já no chão, reclama do bananal
  function drawBrideComplaint() {
    const bride = jumpers[0];
    if (!bride || bride.landedAt === null || crashT < bride.landedAt + 0.3) return;
    const head = bride.y - BRIDE.height;
    speech(["Eca, uma plantação", "de banana!"], bride.x, head - 4, bride.x + 2, (crashT - bride.landedAt - 0.3) * 30);
  }

  function drawWeddingText() {
    const s = wed.t - wed.stopT;
    if (s > PARTY.cheer) {
      // Os convidados gritam, com o balão logo acima deles
      const gx = VENUE_STOP + GUEST_DX[CHEER_GUEST];
      speech(["Viva os noivos!"], gx, H - GROUND_H - 22, gx, (s - PARTY.cheer) * 30);
    }
    if (s < PARTY.toast) return;
    const p = easeOutBack(Math.min((s - PARTY.toast) / 0.5, 1));
    const y = Math.round(-40 + (H * 0.12 + 40) * p + Math.sin(wed.t * 2) * 2);
    text("Parabéns", W / 2, y, 24, { fill: "#ffd23f" });
    text(calendarDate(1), W / 2, y + 30, 16);
    // Botão na terra, embaixo da tela
    if (s > PARTY.button && blink()) button("Jogar novamente", W / 2, H - Math.round(GROUND_H / 2) - 4);
  }

  function drawUI() {
    if (state === STATE.WEDDING) {
      if (wed.stopT === null) drawHUD();
      else drawWeddingText();
      return;
    }
    if (state === STATE.CRASH) drawBrideComplaint();
    if (state === STATE.PLAYING || state === STATE.CRASH) drawHUD();
    else if (state === STATE.READY) drawStartScreen();
    else if (state === STATE.INTRO) drawIntro();
    else drawGameOver();
  }

  function draw() {
    drawBackground();
    if (state !== STATE.INTRO) drawBananal();
    drawObstacles();
    drawGround();
    if (state === STATE.WEDDING) drawVenue();
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
  state = STATE.INTRO;
  resize();
  requestAnimationFrame(loop);
})();
