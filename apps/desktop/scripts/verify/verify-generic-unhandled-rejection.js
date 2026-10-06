// Ad-hoc verification (not part of the repo). Tests whether a GENERIC
// unhandled rejection from a plain user-defined async function (NOT an
// Electron built-in API like loadURL, which the previous test showed gets
// special internal handling) crashes the real Electron main process the
// same way it crashes plain Node.
const { app } = require("electron");

let unhandledRejectionFired = false;
process.on("unhandledRejection", (reason) => {
  unhandledRejectionFired = true;
  console.log("UNHANDLED REJECTION FIRED:", String(reason).slice(0, 200));
});

app.whenReady().then(async () => {
  async function userDefinedAsyncThatThrows() {
    await new Promise((r) => setTimeout(r, 50));
    throw new Error("simulated disk-write failure inside onUpdate");
  }

  console.log("BEFORE unhandled call");
  void userDefinedAsyncThatThrows().finally(() => {
    console.log("finally ran (cleanup)");
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));
  // If we reach here, the process survived - print proof.
  console.log("AFTER 1000ms wait - process is still alive");
  console.log(JSON.stringify({ unhandledRejectionFired, survivedWithoutCrash: true }));
  app.exit(0);
});
