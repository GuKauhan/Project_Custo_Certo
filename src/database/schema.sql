-- =====================================================================
-- Custo Certo - Schema MySQL (painel web)
-- =====================================================================
-- Idempotente: pode rodar repetidas vezes sem quebrar.
--
-- ATENCAO: estas sao as MESMAS tabelas usadas pela aplicacao desktop, que
-- vive em OUTRO REPOSITORIO (Custo-Certo/versao_3semestre). A fonte oficial
-- da modelagem, com as restricoes comentadas uma a uma e a carga inicial, e
-- o arquivo daquele repositorio:
--
--     desktop/src/main/resources/sql/02_schema_insumos.sql
--
-- Aquele e o script entregue na materia de Banco de Dados. Este arquivo
-- repete apenas a parte de CREATE TABLE, para que o servidor Node consiga
-- subir sozinho em uma maquina onde o script do desktop nunca rodou.
-- Quem rodar primeiro cria; o segundo encontra tudo pronto e nao faz nada.
-- Ao alterar uma tabela, altere NOS DOIS REPOSITORIOS.
--
-- As tabelas de acesso (usuarios e log_acesso) ficam so do lado do desktop:
-- o painel web nao tem login.
--
-- As tabelas receitas e receita_ingredientes existiam no schema SQLite
-- anterior, preparadas para uso futuro, e nunca foram usadas por nenhuma
-- rota. Elas ficaram de fora ate o grupo fechar a decisao D5, que define
-- o escopo do DER a ser entregue.
-- =====================================================================

-- =====================================================================
-- TABELA: ingredientes
-- ---------------------------------------------------------------------
-- Estoque ativo de cada insumo da cafeteria.
-- "qtd" e o estoque atual; "qtd_max" e a capacidade de referencia, que
-- corresponde a 100% da barra de nivel exibida na interface.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ingredientes (
    id            INT           NOT NULL AUTO_INCREMENT,
    nome          VARCHAR(120)  NOT NULL,
    unidade       ENUM('kg', 'g', 'L', 'ml', 'un') NOT NULL,
    preco         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    qtd           DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    qtd_max       DECIMAL(10,3) NOT NULL DEFAULT 0.000,
    validade      DATE          NULL,
    criado_em     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT pk_ingredientes      PRIMARY KEY (id),
    CONSTRAINT uk_ingredientes_nome UNIQUE (nome),
    CONSTRAINT ck_ingredientes_preco   CHECK (preco >= 0),
    CONSTRAINT ck_ingredientes_qtd     CHECK (qtd >= 0),
    CONSTRAINT ck_ingredientes_qtd_max CHECK (qtd_max >= 0),

    INDEX idx_ingredientes_nome (nome),
    INDEX idx_ingredientes_validade (validade)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- =====================================================================
-- TABELA: movimentacoes_estoque
-- ---------------------------------------------------------------------
-- Historico de entradas (compras) e saidas (consumo pesado na balanca).
-- Cada compra guarda o preco pago naquele momento, o que alimenta o
-- grafico de evolucao de precos e a apuracao do CMV.
--
-- ON DELETE CASCADE: excluir o insumo apaga o historico dele, porque uma
-- movimentacao sem insumo nao significa nada.
-- =====================================================================
CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
    id             INT           NOT NULL AUTO_INCREMENT,
    ingrediente_id INT           NOT NULL,
    tipo           ENUM('entrada', 'saida') NOT NULL,
    quantidade     DECIMAL(10,3) NOT NULL,
    preco_unitario DECIMAL(10,2) NULL,
    validade       DATE          NULL,
    observacao     VARCHAR(255)  NULL,
    data           DATE          NOT NULL DEFAULT (CURRENT_DATE),
    criado_em      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT pk_movimentacoes PRIMARY KEY (id),
    CONSTRAINT fk_mov_ingrediente
        FOREIGN KEY (ingrediente_id) REFERENCES ingredientes (id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT ck_mov_quantidade CHECK (quantidade > 0),

    INDEX idx_mov_data (data),
    INDEX idx_mov_tipo (tipo)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;
