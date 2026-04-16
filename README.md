# Upload Rede Local — Sistema de Recebimento de Atividades Escolares

Sistema web simples que permite a professores receberem atividades de alunos por meio de upload de arquivos em uma **rede local**. O professor inicia o servidor em seu computador e os alunos acessam pelo navegador usando o IP da máquina na rede.

---

## Como funciona

1. O professor executa o servidor em seu computador.
2. O terminal exibe o endereço de acesso na rede local (ex.: `http://192.168.1.10:8080`).
3. Os alunos, conectados à mesma rede, abrem o endereço no navegador.
4. Cada aluno (ou grupo) preenche o(s) nome(s) e faz upload dos arquivos da atividade.
5. Os arquivos são salvos no computador do professor dentro da pasta `upload/`, organizados por nome do aluno/grupo.

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) (v14 ou superior)

---

## Instalação

```bash
git clone <url-do-repositorio>
cd Upload-Rede-Local
npm install
```

---

## Uso

```bash
npm start
```

A saída no terminal mostrará algo como:

```
=======================================================
  Sistema de Recebimento de Atividades
=======================================================
  Servidor rodando em: http://localhost:8080
  Acesso na rede local: http://192.168.x.x:8080
=======================================================
```

Compartilhe o endereço de **rede local** com os alunos.

---

## Funcionalidades

- **Upload de múltiplos arquivos** — Suporte a arrastar e soltar (drag & drop) ou seleção via botão.
- **Trabalhos em grupo** — O formulário permite adicionar vários nomes de alunos ao mesmo envio.
- **Organização automática** — Os arquivos são salvos em subpastas dentro de `upload/`, nomeadas com o(s) nome(s) do(s) aluno(s).
- **Histórico de envios** — Uma lista de atividades já enviadas é exibida na própria página e atualizada em tempo real.
- **Zero configuração de rede** — Basta que os computadores estejam na mesma rede local (Wi-Fi ou cabo).

---

## Estrutura do projeto

```
Upload-Rede-Local/
├── server.js        # Servidor Express (API + arquivos estáticos)
├── db.json          # Banco de dados simples (registro dos envios)
├── package.json     # Dependências e scripts
├── public/          # Frontend (servido automaticamente)
│   ├── index.html
│   ├── script.js
│   └── style.css
└── upload/          # Pasta onde os arquivos enviados são armazenados
```

---

## Tecnologias

| Camada   | Tecnologia           |
|----------|----------------------|
| Backend  | Node.js + Express    |
| Upload   | Multer               |
| Frontend | HTML, CSS, JavaScript puro |
| Banco    | Arquivo JSON (`db.json`) |

---

## API

| Método | Rota           | Descrição                              |
|--------|----------------|----------------------------------------|
| POST   | `/api/enviar`  | Recebe os arquivos e registra o envio  |
| GET    | `/api/envios`  | Retorna a lista de envios realizados   |

---

## Observações

- O servidor escuta na porta **8080** e aceita conexões de qualquer interface (`0.0.0.0`), permitindo o acesso pela rede local.
- Os registros de envio (nomes, data, lista de arquivos) são persistidos em `db.json`.
- Não há autenticação — o sistema é projetado para uso em ambiente controlado de sala de aula.
