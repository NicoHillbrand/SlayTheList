const { spawn } = require("child_process");
const electron = require("electron");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ["."], {
  stdio: "inherit",
  cwd: __dirname,
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));
