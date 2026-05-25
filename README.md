# Upload Rede Local — Sistema de Recebimento de Atividades Escolares

Sistema web para professores receberem atividades de alunos por **upload de arquivos em rede local**. O professor executa o servidor no próprio computador; os alunos acessam pelo navegador usando o IP da máquina na rede, sem instalar nada.

---

## Fluxo geral

```
Professor                          Aluno
─────────────────────────────────────────────────────────
1. Cria uma conta em /cadastro
2. Faz login em /login
3. No painel /admin, cria          4. Recebe o link /<atividade>
   uma atividade (ex: prova1)         do professor
                                   5. Acessa o link e faz
                                      upload dos arquivos
6. Em /admin visualiza os envios,
   baixa individualmente ou
   finaliza (ZIP geral + remove)
```

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) v14 ou superior
- Computadores do professor e alunos na **mesma rede local** (Wi-Fi ou cabo)

---

## Instalação e execução

```bash
git clone <url-do-repositorio>
cd Upload-Rede-Local
npm install
npm start
```

O terminal exibirá o endereço de acesso:

```
=======================================================
  Sistema de Recebimento de Atividades
=======================================================
  Acesso na rede local: http://192.168.x.x:3000
=======================================================
  Cadastro de professor: /cadastro
  Login de professor:    /login
  Painel do professor:   /admin
  Alunos:                /<path-da-atividade>
=======================================================
```

### Porta personalizada

Crie um arquivo `.env` na raiz com:

```
PORT=8080
```

---

## Páginas e rotas

### Para o professor

| Rota | Descrição |
|------|-----------|
| `/cadastro` | Criação de conta (usuário + senha) |
| `/login` | Autenticação do professor |
| `/admin` | Painel principal — requer login |

### Para o aluno

| Rota | Descrição |
|------|-----------|
| `/<nome-da-atividade>` | Página de upload gerada pelo professor |

> Se o path não existir ou estiver encerrado, o aluno vê uma página 404.

---

## Funcionalidades detalhadas

### Cadastro de professor (`/cadastro`)

- O professor cria uma conta informando **usuário** (3–30 caracteres: letras, números, `.`, `-`, `_`) e **senha** (mínimo 6 caracteres).
- Usuários são únicos — tentativa de duplicata retorna erro 409.
- Após o cadastro, o professor é redirecionado para `/login`.

---

### Login (`/login`)

- Autenticação por usuário e senha.
- Em caso de sucesso, o servidor gera um **token de sessão** de 32 bytes aleatórios (`crypto.randomBytes`) e o define como cookie `HttpOnly; SameSite=Strict`, válido por **8 horas**.
- A sessão é armazenada em memória no servidor (não persiste entre reinicializações).

---

### Painel do professor (`/admin`)

Acesso restrito — redireciona para `/login` se não autenticado.

#### Criar atividade
- O professor define um **path** para a atividade (ex: `prova1`, `trabalho-final`).
- Regras do path: apenas letras, números e hifens; máximo 49 caracteres; paths reservados não são permitidos.
- Cada path é **globalmente único** no sistema.
- Ao criar, a pasta `upload/<usuario>/<path>/` é gerada automaticamente.
- O professor copia o link exibido (ex: `http://192.168.x.x:3000/prova1`) e repassa aos alunos.

#### Tabela de atividades
Exibe todas as atividades criadas pelo professor logado com:
- Link completo para os alunos
- Data de criação
- Contador de envios recebidos
- Botões **Visualizar** e **Finalizar**

#### Visualizar envios (modal)
- Abre um modal sem sair da página.
- Lista todos os alunos que entregaram: nome(s), arquivo(s), data do envio.
- Botão **⬇ Baixar** em cada linha: gera um ZIP **somente daquele envio** e inicia o download.
- **Nada é removido** do sistema.
- Fecha com `×`, clique fora do modal ou tecla `Esc`.

#### Finalizar atividade
- Gera um ZIP com **todos os envios** da atividade (cada aluno em sua própria subpasta).
- Após o download completo, **remove permanentemente**: a pasta de uploads, os registros de envio e o registro da atividade do banco.
- A conta do professor **não é removida**.
- Ação irreversível — exige confirmação no navegador.

---

### Upload do aluno (`/<nome-da-atividade>`)

- Formulário com campo(s) de nome e área de arrastar/soltar arquivos.
- Suporte a **múltiplos arquivos** e **trabalho em grupo** (vários nomes).
- Exibe lista de envios já realizados naquela atividade (atualizados em tempo real).
- Os arquivos são salvos em `upload/<usuario-professor>/<path-atividade>/<nomes-alunos>/`.

---

## API REST

### Autenticação

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| `POST` | `/api/cadastro` | — | Cria conta de professor |
| `POST` | `/api/login` | — | Autentica e define cookie de sessão |
| `POST` | `/api/logout` | Cookie | Invalida a sessão |
| `GET` | `/api/me` | Cookie | Retorna o usuário da sessão ativa |

### Atividades (professor autenticado)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| `GET` | `/api/admin/atividades` | Cookie | Lista atividades do professor logado |
| `POST` | `/api/admin/atividades` | Cookie | Cria nova atividade |
| `GET` | `/api/admin/atividades/:path/envios` | Cookie | Lista todos os envios de uma atividade |
| `POST` | `/api/admin/atividades/:path/finalizar` | Cookie | Gera ZIP geral + remove atividade e envios |
| `GET` | `/api/admin/envios/:id/download` | Cookie | Download ZIP de um envio específico (sem apagar) |

### Alunos (público)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| `POST` | `/api/enviar/:path` | — | Recebe arquivos do aluno |
| `GET` | `/api/envios/:path` | — | Lista envios de uma atividade (para exibir na página do aluno) |

---

## Banco de dados (`db.json`)

Arquivo JSON com três coleções:

```json
{
  "professores": [
    {
      "id": 1234567890,
      "usuario": "prof.joao",
      "senhaHash": "<sha256>",
      "criadoEm": "25/05/2026, 09:00:00"
    }
  ],
  "atividades": [
    {
      "id": 1234567891,
      "professorId": 1234567890,
      "path": "prova1",
      "criadaEm": "25/05/2026, 09:05:00"
    }
  ],
  "envios": [
    {
      "id": 1234567892,
      "atividadePath": "prova1",
      "nomes": ["Maria Silva", "João Souza"],
      "ip": "192.168.1.5",
      "pasta": "Maria Silva - João Souza",
      "arquivos": ["trabalho.pdf"],
      "dataEnvio": "25/05/2026, 09:30:00"
    }
  ]
}
```

> Senhas são armazenadas como hash SHA-256. O arquivo é regravado a cada operação de escrita.

---

## Estrutura de pastas

```
Upload-Rede-Local/
├── server.js           # Servidor Express (toda a lógica de backend)
├── db.json             # Banco de dados em JSON
├── package.json        # Dependências e scripts npm
├── .env                # (opcional) Variáveis de ambiente, ex: PORT=8080
├── public/             # Arquivos estáticos servidos diretamente
│   ├── index.html      # (não utilizado ativamente)
│   ├── script.js
│   └── style.css       # Folha de estilos compartilhada por todas as views
├── views/              # Páginas HTML renderizadas pelo servidor
│   ├── cadastro.html   # Cadastro de professor
│   ├── login.html      # Login de professor
│   ├── admin.html      # Painel do professor (atividades + modal de envios)
│   ├── upload.html     # Página de upload para alunos
│   └── 404.html        # Página de atividade não encontrada
└── upload/             # Arquivos enviados pelos alunos
    └── <usuario>/
        └── <atividade>/
            └── <nome(s)-do(s)-aluno(s)>/
                └── arquivo.pdf
```

---

## Segurança

| Aspecto | Implementação |
|---------|---------------|
| Senhas | Hash SHA-256 — nunca armazenadas em texto puro |
| Sessões | Token de 32 bytes aleatórios (`crypto.randomBytes`) |
| Cookie | `HttpOnly` + `SameSite=Strict` — protegido contra XSS e CSRF |
| Expiração de sessão | 8 horas; invalidada automaticamente no servidor |
| Paths de atividade | Validados por regex + lista de paths reservados |
| Nomes de pasta | Caracteres especiais substituídos antes de criar diretórios |
| Isolamento de dados | Professor só acessa suas próprias atividades e envios |

> O sistema é projetado para uso em **rede local controlada** (sala de aula). Não é recomendado expô-lo diretamente à internet sem camadas adicionais de segurança (HTTPS, firewall, proxy reverso).

---

## Tecnologias

| Camada | Tecnologia |
|--------|------------|
| Backend | Node.js + Express 4 |
| Upload de arquivos | Multer |
| Geração de ZIP | Archiver v8 (`ZipArchive`) |
| Segurança | Node.js `crypto` (built-in) |
| Frontend | HTML5 + CSS3 + JavaScript puro |
| Banco de dados | Arquivo JSON (`db.json`) |
| Configuração | dotenv |

