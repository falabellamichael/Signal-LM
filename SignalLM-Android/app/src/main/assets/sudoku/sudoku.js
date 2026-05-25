let board = [];
let solution = [];
let selectedCell = null;
let moves = 0;
let timerInterval;
let seconds = 0;
let difficulty = 'easy';

const difficulties = {
    easy: { rows: 30, cols: 20 },
    medium: { rows: 40, cols: 30 },
    hard: { rows: 50, cols: 40 }
};

function newGame() {
    clearInterval(timerInterval);
    seconds = 0;
    moves = 0;
    selectedCell = null;
    document.getElementById('message').className = 'message';
    document.getElementById('moves').textContent = '0';
    document.getElementById('time').textContent = '0:00';

    const { rows, cols } = difficulties[difficulty];
    board = Array(rows).fill(null).map(() => Array(cols).fill(0));
    solution = Array(rows).fill(null).map(() => Array(cols).fill(0));
    generateBoard();
    removeCells(rows * cols - rows, difficulty);
    renderBoard();
}

function generateBoard() {
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            if (Math.random() > 0.7) {
                board[r][c] = Math.floor(Math.random() * 9) + 1;
            }
        }
    }
}

function removeCells(count, difficulty) {
    let removed = 0;
    while (removed < count) {
        const r = Math.floor(Math.random() * board.length);
        const c = Math.floor(Math.random() * board[r].length);
        if (board[r][c] !== 0 && !solution[r][c]) {
            board[r][c] = 0;
            removed++;
        }
    }
}

function renderBoard() {
    const boardEl = document.getElementById('board');
    boardEl.innerHTML = '';

    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = r;
            cell.dataset.col = c;

            if (board[r][c] !== 0) {
                cell.classList.add('fixed');
                cell.textContent = board[r][c];
            } else if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
                cell.classList.add('selected');
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'number-input';
                input.min = 1;
                input.max = 9;
                input.onchange = () => handleInput(r, c, parseInt(input.value));
                cell.appendChild(input);
            } else if (selectedCell) {
                cell.classList.add('highlighted');
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'number-input';
                input.min = 1;
                input.max = 9;
                input.onchange = () => handleInput(r, c, parseInt(input.value));
                cell.appendChild(input);
            } else {
                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'number-input';
                input.min = 1;
                input.max = 9;
                input.onchange = () => handleInput(r, c, parseInt(input.value));
                cell.appendChild(input);
            }

            boardEl.appendChild(cell);
        }
    }
}

function handleInput(r, c, num) {
    if (num < 1 || num > 9) return;
    moves++;
    document.getElementById('moves').textContent = moves;
    board[r][c] = num;
    selectedCell = { r, c };

    const cells = document.querySelectorAll('.cell');
    for (let i = 0; i < cells.length; i++) {
        if (!cells[i].classList.contains('fixed')) {
            cells[i].removeChild(cells[i].querySelector('input'));
            cells[i].textContent = '';
        }
    }

    const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
    if (cell) {
        cell.textContent = num;
        cell.classList.add('user-input');
    }

    highlightCells(r, c, num);
}

function highlightCells(r, c, num) {
    const cells = document.querySelectorAll('.cell');
    for (let i = 0; i < cells.length; i++) {
        if (!cells[i].classList.contains('fixed')) {
            const cr = parseInt(cells[i].dataset.row);
            const cc = parseInt(cells[i].dataset.col);
            const val = parseInt(cells[i].textContent) || 0;

            if (cr === r || cc === c) cells[i].classList.add('highlighted');
            else if (val === num && !cells[i].classList.contains('fixed')) {
                cells[i].classList.add('same-number');
            }
        }
    }
}

function checkSolution() {
    let errors = 0;
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            if (board[r][c] !== solution[r][c]) {
                const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);
                if (cell) {
                    cell.classList.add('error');
                    setTimeout(() => cell.classList.remove('error'), 500);
                    errors++;
                }
            }
        }
    }

    const messageEl = document.getElementById('message');
    if (errors === 0) {
        messageEl.className = 'message success';
        messageEl.textContent = '🎉 Congratulations! You solved the puzzle!';
        clearInterval(timerInterval);
    } else {
        messageEl.className = 'message error';
        messageEl.textContent = `❌ ${errors} error(s) found. Keep going!`;
    }
}

function hint() {
    for (let r = 0; r < board.length; r++) {
        for (let c = 0; c < board[r].length; c++) {
            if (board[r][c] === 0 && solution[r][c]) {
                handleInput(r, c, solution[r][c]);
                return;
            }
        }
    }
}

function inputNumber(num) {
    if (selectedCell) {
        handleInput(selectedCell.r, selectedCell.c, num);
    }
}

function deleteCell() {
    if (selectedCell && board[selectedCell.r][selectedCell.c] === 0) return;
    moves++;
    document.getElementById('moves').textContent = moves;
    board[selectedCell.r][selectedCell.c] = 0;
    selectedCell = null;

    const cell = document.querySelector(`.cell[data-row="${selectedCell?.r}"][data-col="${selectedCell?.c}"]`);
    if (cell) {
        cell.textContent = '';
        cell.classList.remove('user-input');
    }
}

function startTimer() {
    timerInterval = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        document.getElementById('time').textContent = `${mins}:${secs}`;
    }, 1000);
}

function switchDifficulty(diff) {
    difficulty = diff;
    document.querySelectorAll('.difficulty-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.difficulty === diff);
    });
    newGame();
}

document.addEventListener('keydown', (e) => {
    if (!selectedCell) return;

    const key = e.key;
    if (key >= '1' && key <= '9') inputNumber(parseInt(key));
    else if (key === 'Backspace' || key === 'Delete') deleteCell();
    else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
        const dr = ['ArrowUp', 'ArrowDown'].includes(key) ? 1 : -1;
        const dc = ['ArrowLeft', 'ArrowRight'].includes(key) ? 1 : -1;
        const nr = selectedCell.r + dr;
        const nc = selectedCell.c + dc;
        if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[nr].length) {
            selectedCell = { r: nr, c: nc };
            renderBoard();
        }
    }
});

document.querySelectorAll('.difficulty-btn').forEach(btn => {
    btn.addEventListener('click', () => switchDifficulty(btn.dataset.difficulty));
});

newGame();