import express from "express";
import cors from "cors";
import routes from "./routes";

const app = express();
const port = process.env.PORT;

// Parse allowed origins from environment or use defaults
const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ['X-Sandbox-URL', 'X-Sandbox-ID']
}));

app.use(express.json());

app.use("/", routes);

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
