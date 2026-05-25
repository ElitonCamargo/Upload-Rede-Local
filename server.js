const express = require('express');
const multer  = require('multer');
const { ZipArchive } = require('archiver');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const crypto  = require('crypto');

require('dotenv').config();

const app  = express();
const PORT = parseInt(process.env.port || process.env.PORT || '3000', 10);

// Caminhos principais
const UPLOAD_DIR = path.join(__dirname, 'upload');
const DB_FILE    = path.join(__dirname, 'db.json');
const VIEWS_DIR  = path.join(__dirname, 'views');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ professores: [], atividades: [], envios: [] }, null, 2));
}

// ============================================================
// Sessoes em memoria
// ============================================================

const sessoes = new Map(); // token -> { professorId, usuario, expiresAt }

function criarSessao(professorId, usuario) {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 horas
  sessoes.set(token, { professorId, usuario, expiresAt });
  return token;
}

function obterSessao(token) {
  if (!token) return null;
  const sessao = sessoes.get(token);
  if (!sessao) return null;
  if (Date.now() > sessao.expiresAt) { sessoes.delete(token); return null; }
  return sessao;
}

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  return cookies;
}

// ============================================================
// Helpers
// ============================================================

function lerBanco() {
  try {
    const dados = fs.readFileSync(DB_FILE, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!dados) return { professores: [], atividades: [], envios: [] };
    const db = JSON.parse(dados);
    if (!db) return { professores: [], atividades: [], envios: [] };
    if (!Array.isArray(db.professores)) db.professores = [];
    if (!Array.isArray(db.envios))      db.envios      = [];

    // Migracao: versao antiga nao tinha atividades separadas
    if (!Array.isArray(db.atividades)) {
      db.atividades = [];
      for (const prof of db.professores) {
        if (prof.path) {
          // Mover pasta upload/<path>/ para upload/<usuario>/<path>/
          const oldDir = path.join(UPLOAD_DIR, sanitizarNomePasta(prof.path));
          const newDir = path.join(UPLOAD_DIR, sanitizarNomePasta(prof.usuario), sanitizarNomePasta(prof.path));
          if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
            fs.mkdirSync(path.dirname(newDir), { recursive: true });
            try { fs.renameSync(oldDir, newDir); } catch (_) {}
          }
          db.atividades.push({
            id:          prof.id + 1,
            professorId: prof.id,
            path:        prof.path,
            criadaEm:    prof.criadoEm || ''
          });
          delete prof.path;
        }
      }
      // Migrar campo professorPath -> atividadePath nos envios
      for (const envio of db.envios) {
        if (envio.professorPath && !envio.atividadePath) {
          envio.atividadePath = envio.professorPath;
          delete envio.professorPath;
        }
      }
      salvarBanco(db);
    }
    return db;
  } catch (err) {
    console.error('db.json invalido, resetando banco:', err.message);
    const banco = { professores: [], atividades: [], envios: [] };
    salvarBanco(banco);
    return banco;
  }
}

function salvarBanco(dados) {
  fs.writeFileSync(DB_FILE, JSON.stringify(dados, null, 2));
}

function hashSenha(senha) {
  return crypto.createHash('sha256').update(senha).digest('hex');
}

function sanitizarNomePasta(nome) {
  return nome.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

const PATHS_RESERVADOS = new Set([
  'admin', 'cadastro', 'login', 'logout', 'api', 'prof',
  'public', 'upload', 'views', 'node_modules', 'favicon.ico',
  'style.css', 'script.js'
]);

function validarPath(p) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]{0,48}$/.test(p) &&
         !PATHS_RESERVADOS.has(p.toLowerCase());
}

// ============================================================
// Multer - destino: upload/<profUsuario>/<atividadePath>/<aluno>/
// ============================================================

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { atividadePath } = req.params;
    const db        = lerBanco();
    const atividade = db.atividades.find(a => a.path === atividadePath.toLowerCase());
    if (!atividade) return cb(new Error('Atividade nao encontrada'));
    const professor = db.professores.find(p => p.id === atividade.professorId);
    if (!professor) return cb(new Error('Professor nao encontrado'));

    const nomes     = JSON.parse(req.body.nomes || '[]');
    const nomePasta = sanitizarNomePasta(nomes.join(' - '));
    const destino   = path.join(
      UPLOAD_DIR,
      sanitizarNomePasta(professor.usuario),
      sanitizarNomePasta(atividade.path),
      nomePasta
    );
    if (!fs.existsSync(destino)) fs.mkdirSync(destino, { recursive: true });
    cb(null, destino);
  },
  filename: (_req, file, cb) => {
    cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'));
  }
});

const upload = multer({ storage });

// ============================================================
// Middlewares globais
// ============================================================

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de autenticacao
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  const sessao  = obterSessao(cookies.session_token);
  if (!sessao) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ erro: 'Nao autenticado. Faca login.' });
    return res.redirect('/login');
  }
  req.professor = sessao;
  next();
}

// ============================================================
// Rotas HTML
// ============================================================

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.redirect('/login');
});

app.get('/cadastro', (_req, res) => res.sendFile(path.join(VIEWS_DIR, 'cadastro.html')));

app.get('/login', (_req, res) => res.sendFile(path.join(VIEWS_DIR, 'login.html')));

app.get('/admin', requireAuth, (_req, res) => res.sendFile(path.join(VIEWS_DIR, 'admin.html')));

// ============================================================
// API - Autenticacao
// ============================================================

// POST /api/cadastro
app.post('/api/cadastro', (req, res) => {
  const { usuario, senha } = req.body;
  if (!usuario?.trim() || !senha?.trim()) {
    return res.status(400).json({ erro: 'Informe usuario e senha.' });
  }
  if (!/^[a-zA-Z0-9._-]{3,30}$/.test(usuario.trim())) {
    return res.status(400).json({ erro: 'Usuario invalido. Use 3-30 caracteres: letras, numeros, ponto, hifen ou underscore.' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha deve ter pelo menos 6 caracteres.' });
  }
  const db = lerBanco();
  if (db.professores.some(p => p.usuario.toLowerCase() === usuario.trim().toLowerCase())) {
    return res.status(409).json({ erro: 'Este usuario ja esta em uso.' });
  }
  const novoProfessor = {
    id:        Date.now(),
    usuario:   usuario.trim(),
    senhaHash: hashSenha(senha),
    criadoEm:  new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  };
  db.professores.push(novoProfessor);
  salvarBanco(db);
  res.json({ sucesso: true, mensagem: 'Conta criada com sucesso! Faca login.' });
});

// POST /api/login
app.post('/api/login', (req, res) => {
  const { usuario, senha } = req.body;
  if (!usuario?.trim() || !senha?.trim()) {
    return res.status(400).json({ erro: 'Informe usuario e senha.' });
  }
  const db = lerBanco();
  const professor = db.professores.find(p =>
    p.usuario.toLowerCase() === usuario.trim().toLowerCase() &&
    p.senhaHash === hashSenha(senha)
  );
  if (!professor) {
    return res.status(401).json({ erro: 'Usuario ou senha incorretos.' });
  }
  const token = criarSessao(professor.id, professor.usuario);
  res.setHeader('Set-Cookie', `session_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
  res.json({ sucesso: true, usuario: professor.usuario });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.session_token) sessoes.delete(cookies.session_token);
  res.setHeader('Set-Cookie', 'session_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ sucesso: true });
});

// GET /api/me
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ usuario: req.professor.usuario });
});

// ============================================================
// API - Atividades (professor logado)
// ============================================================

// GET /api/admin/atividades
app.get('/api/admin/atividades', requireAuth, (req, res) => {
  const db = lerBanco();
  const atividades = db.atividades
    .filter(a => a.professorId === req.professor.professorId)
    .map(a => ({
      ...a,
      totalEnvios: db.envios.filter(e => e.atividadePath === a.path).length
    }));
  res.json(atividades);
});

// POST /api/admin/atividades
app.post('/api/admin/atividades', requireAuth, (req, res) => {
  const { path: atividadePath } = req.body;
  if (!atividadePath?.trim()) {
    return res.status(400).json({ erro: 'Informe o path da atividade.' });
  }
  if (!validarPath(atividadePath.trim())) {
    return res.status(400).json({ erro: 'Path invalido. Use apenas letras, numeros e hifens (max 49 caracteres).' });
  }
  const db = lerBanco();
  if (db.atividades.some(a => a.path === atividadePath.trim().toLowerCase())) {
    return res.status(409).json({ erro: 'Este path ja esta em uso por outra atividade.' });
  }
  const professor = db.professores.find(p => p.id === req.professor.professorId);
  if (!professor) return res.status(401).json({ erro: 'Professor nao encontrado.' });

  const novaAtividade = {
    id:          Date.now(),
    professorId: req.professor.professorId,
    path:        atividadePath.trim().toLowerCase(),
    criadaEm:   new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  };
  db.atividades.push(novaAtividade);

  const dirAtividade = path.join(UPLOAD_DIR, sanitizarNomePasta(professor.usuario), sanitizarNomePasta(novaAtividade.path));
  if (!fs.existsSync(dirAtividade)) fs.mkdirSync(dirAtividade, { recursive: true });

  salvarBanco(db);
  res.json({ sucesso: true, atividade: novaAtividade });
});

// POST /api/admin/atividades/:atividadePath/finalizar
app.post('/api/admin/atividades/:atividadePath/finalizar', requireAuth, (req, res) => {
  try {
    const { atividadePath } = req.params;
    const db = lerBanco();
    const atividade = db.atividades.find(
      a => a.path === atividadePath.toLowerCase() && a.professorId === req.professor.professorId
    );
    if (!atividade) {
      return res.status(404).json({ erro: 'Atividade nao encontrada ou sem permissao.' });
    }
    const professor = db.professores.find(p => p.id === req.professor.professorId);
    if (!professor) return res.status(401).json({ erro: 'Professor nao encontrado.' });

    const dirAtividade = path.join(UPLOAD_DIR, sanitizarNomePasta(professor.usuario), sanitizarNomePasta(atividade.path));
    const nomeArquivo  = `${professor.usuario}-${atividade.path}-${Date.now()}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('Erro ao gerar ZIP:', err);
      if (!res.headersSent) res.status(500).json({ erro: 'Erro ao gerar arquivo ZIP.' });
      else res.end();
    });

    // Remove pasta e registros apenas apos envio completo do ZIP
    res.on('finish', () => {
      if (res.statusCode === 200) {
        try {
          if (fs.existsSync(dirAtividade)) fs.rmSync(dirAtividade, { recursive: true, force: true });
          const dbAtualizado = lerBanco();
          dbAtualizado.atividades = dbAtualizado.atividades.filter(a => a.id !== atividade.id);
          dbAtualizado.envios     = dbAtualizado.envios.filter(e => e.atividadePath !== atividade.path);
          salvarBanco(dbAtualizado);
        } catch (err) {
          console.error('Erro ao limpar dados apos ZIP:', err);
        }
      }
    });

    archive.pipe(res);

    if (fs.existsSync(dirAtividade)) {
      const itens = fs.readdirSync(dirAtividade, { withFileTypes: true });
      for (const item of itens.filter(i => i.isDirectory())) {
        archive.directory(path.join(dirAtividade, item.name), item.name);
      }
    }

    archive.finalize();
  } catch (err) {
    console.error('Erro ao finalizar atividade:', err);
    res.status(500).json({ erro: 'Erro interno ao finalizar atividade.' });
  }
});

// ============================================================
// API - Alunos
// ============================================================

// POST /api/enviar/:atividadePath
app.post('/api/enviar/:atividadePath', upload.array('arquivos'), (req, res) => {
  try {
    const { atividadePath } = req.params;
    const nomes = JSON.parse(req.body.nomes || '[]');

    if (!nomes.length || nomes.some(n => !n.trim())) {
      return res.status(400).json({ erro: 'Informe o nome de todos os alunos.' });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ erro: 'Envie pelo menos um arquivo.' });
    }

    const db = lerBanco();
    const atividade = db.atividades.find(a => a.path === atividadePath.toLowerCase());
    if (!atividade) {
      return res.status(404).json({ erro: 'Atividade nao encontrada.' });
    }

    const nomePasta = sanitizarNomePasta(nomes.join(' - '));
    const ip = req.socket.remoteAddress || req.ip || 'desconhecido';

    db.envios.push({
      id:            Date.now(),
      atividadePath: atividade.path,
      nomes,
      ip,
      pasta:     nomePasta,
      arquivos:  req.files.map(f => Buffer.from(f.originalname, 'latin1').toString('utf8')),
      dataEnvio: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    });
    salvarBanco(db);
    res.json({ sucesso: true, mensagem: 'Atividade enviada com sucesso!' });
  } catch (err) {
    console.error('Erro ao processar envio:', err);
    res.status(500).json({ erro: 'Erro interno ao processar o envio.' });
  }
});

// GET /api/envios/:atividadePath
app.get('/api/envios/:atividadePath', (req, res) => {
  try {
    const { atividadePath } = req.params;
    const db = lerBanco();
    const envios = db.envios.filter(e => e.atividadePath === atividadePath.toLowerCase());
    res.json(envios);
  } catch (err) {
    console.error('Erro ao ler envios:', err);
    res.status(500).json({ erro: 'Erro ao buscar os envios.' });
  }
});

// ============================================================
// Catch-all: pagina de upload dos alunos (DEVE ser a ultima GET)
// ============================================================

app.get('/:atividadePath', (req, res) => {
  const { atividadePath } = req.params;

  if (PATHS_RESERVADOS.has(atividadePath.toLowerCase())) {
    return res.status(404).sendFile(path.join(VIEWS_DIR, '404.html'));
  }

  const db = lerBanco();
  const atividade = db.atividades.find(a => a.path === atividadePath.toLowerCase());
  if (!atividade) {
    return res.status(404).sendFile(path.join(VIEWS_DIR, '404.html'));
  }

  res.sendFile(path.join(VIEWS_DIR, 'upload.html'));
});

// ============================================================
// Inicia o servidor
// ============================================================

app.listen(PORT, '0.0.0.0', () => {
  const interfaces = os.networkInterfaces();
  let ipLocal = 'localhost';
  for (const nome of Object.keys(interfaces)) {
    for (const iface of interfaces[nome]) {
      if (iface.family === 'IPv4' && !iface.internal) { ipLocal = iface.address; break; }
    }
  }
  console.log('='.repeat(55));
  console.log('  Sistema de Recebimento de Atividades');
  console.log('='.repeat(55));
  console.log(`  Acesso na rede local: http://${ipLocal}:${PORT}`);
  console.log('='.repeat(55));
  console.log(`  Cadastro de professor: /cadastro`);
  console.log(`  Login de professor:    /login`);
  console.log(`  Painel do professor:   /admin`);
  console.log(`  Alunos:                /<path-da-atividade>`);
  console.log('='.repeat(55));
});
