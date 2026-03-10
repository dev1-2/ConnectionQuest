const express = require("express");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDir = __dirname;

app.disable("x-powered-by");

app.use(express.static(publicDir, {
	extensions: ["html"],
}));

app.get("/health", (_request, response) => {
	response.json({ ok: true });
});

app.get("*", (_request, response) => {
	response.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});