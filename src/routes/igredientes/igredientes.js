const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Nosso "Banco de Dados" temporário (Um Array vazio) entao no futuro quando tiver o banco de dados, isso aqui nao ira existir e apenas para realizar teste
// zera se reiniciar o servidor
let ingredientesDB = [];
let idContador = 1; // Para simular o ID automático do banco

// CADASTRAR
app.post('/ingredientes', (req, res) => {
    const { nome, unidade, preco } = req.body; 

    // Validação
    if (!nome || preco < 0) {
        return res.status(400).json({ erro: "Dados inválidos!" });
    }

    // Cria o objeto do ingrediente simulando como o banco
    const novoIngrediente = {
        id: idContador++,
        nome: nome,
        unidade: unidade,
        preco: preco
    };

    // Salva na nossa lista em memória
    ingredientesDB.push(novoIngrediente);

    return res.status(201).json({ 
        mensagem: "Ingrediente salvo na memória!",
        dadoSalvo: novoIngrediente 
    });
});

app.get('/ingredientes', (req, res) => {
    // Devolve a lista completa para o Front-end mostrar na tela
    return res.status(200).json(ingredientesDB);
});

app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000 com Banco em Memória! 🚀");
});