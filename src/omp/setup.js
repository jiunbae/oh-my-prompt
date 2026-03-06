const os = require("os");
const fs = require("fs");
const { loadConfig, saveConfig } = require("./config");
const { validateToken } = require("./validate");
const { c, loadClack, handleCancel, isInteractive } = require("./ui");

// --- Utility helpers ---

function commandExists(cmd) {
  const { spawnSync } = require("child_process");
  const result = spawnSync("which", [cmd], { stdio: "ignore" });
  return result.status === 0;
}

function detectClis() {
  const targets = [];
  const home = os.homedir();
  const path = require("path");
  const xdgConfigHome =
    process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  if (commandExists("claude") || fs.existsSync(path.join(home, ".claude"))) {
    targets.push("claude");
  }
  if (commandExists("codex") || fs.existsSync(path.join(home, ".codex"))) {
    targets.push("codex");
  }
  if (commandExists("gemini") || fs.existsSync(path.join(home, ".gemini"))) {
    targets.push("gemini");
  }
  if (
    commandExists("opencode") ||
    fs.existsSync(path.join(xdgConfigHome, "opencode"))
  ) {
    targets.push("opencode");
  }
  return targets;
}

function resolveCliTargets(options) {
  if (options["no-hooks"]) return [];
  if (options.hooks) {
    if (options.hooks === "none") return [];
    if (options.hooks === "all") return ["claude", "codex", "gemini", "opencode"];
    return options.hooks.split(",").map((s) => s.trim());
  }
  return detectClis();
}

function normalizeUrl(url) {
  if (!url) return url;
  url = url.trim();
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  return url.replace(/\/$/, "");
}

async function cliLogin(
  serverUrl,
  email,
  password,
  autoRegister = false,
  name = undefined
) {
  const url = `${serverUrl}/api/auth/cli-login`;
  const body = JSON.stringify({ email, password, autoRegister, name });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await res.json();

  if (res.ok && data.success) {
    return {
      ok: true,
      token: data.token,
      registered: !!data.registered,
      user: data.user,
    };
  }

  return {
    ok: false,
    status: res.status,
    code: data.code || null,
    error: data.error || "Authentication failed",
  };
}

// --- CLI display name helper ---
function cliDisplayName(cli) {
  if (cli === "claude") return "Claude Code";
  if (cli === "codex") return "Codex";
  if (cli === "gemini") return "Gemini CLI";
  return "OpenCode";
}

// --- Main wizard ---

async function runSetup(options) {
  const interactive = isInteractive(options);

  const result = {
    ok: true,
    config: {},
    db: {},
    hooks: {},
    validation: null,
    doctor: {},
  };

  // Load existing config or start fresh
  let config;
  try {
    config = loadConfig();
  } catch {
    config = require("./config").defaultConfig();
  }

  const { getConfigPath } = require("./paths");
  const hasExistingConfig = fs.existsSync(getConfigPath());

  // --- Interactive path (clack prompts) ---
  if (interactive) {
    const clack = await loadClack();

    clack.intro(c.bold(c.cyan("oh-my-prompt")));

    // Preamble: check existing config
    if (hasExistingConfig) {
      clack.log.info(
        "Existing configuration found. Values will be pre-filled."
      );
      const proceed = await clack.confirm({
        message: "Continue with setup?",
        initialValue: true,
      });
      handleCancel(proceed);
      if (!proceed) {
        clack.outro(c.dim("Setup cancelled."));
        result.ok = false;
        return result;
      }
    }

    // --- Step 1: Server URL ---
    const defaultUrl = config.server.url || "https://prompt.jiun.dev";
    let serverUrl;
    if (options.server) {
      serverUrl = normalizeUrl(options.server);
      clack.log.info(`Server URL: ${c.cyan(serverUrl)}`);
    } else {
      const answer = await clack.text({
        message: "Server URL",
        placeholder: defaultUrl,
        defaultValue: defaultUrl,
        validate(value) {
          const url = normalizeUrl(value);
          if (!url) return "Server URL is required.";
        },
      });
      handleCancel(answer);
      serverUrl = normalizeUrl(answer);
    }
    config.server.url = serverUrl;

    // --- Step 2: Authentication ---
    const existingToken = config.server.token;
    let token;
    if (options.token) {
      token = options.token;
      clack.log.info("Using provided token.");
    } else {
      const authChoice = await clack.select({
        message: "Authentication",
        options: [
          {
            value: "login",
            label: "Login with email & password",
            hint: "recommended",
          },
          { value: "token", label: "Paste existing API token" },
        ],
      });
      handleCancel(authChoice);

      if (authChoice === "login") {
        const email = await clack.text({
          message: "Email",
          validate(value) {
            if (!value || !value.trim()) return "Email is required.";
          },
        });
        handleCancel(email);

        const password = await clack.password({
          message: "Password",
          validate(value) {
            // Allow empty for new account registration flow
          },
        });
        handleCancel(password);

        if (password) {
          // Existing account - try login
          const s = clack.spinner();
          s.start("Authenticating...");
          const loginResult = await cliLogin(serverUrl, email, password);

          if (loginResult.ok) {
            token = loginResult.token;
            s.stop(`Logged in as ${c.cyan(loginResult.user.email)}`);
          } else if (loginResult.code === "USER_NOT_FOUND") {
            s.stop(c.yellow("Account not found."));
            const doRegister = await clack.confirm({
              message: "Create a new account with this email?",
              initialValue: true,
            });
            handleCancel(doRegister);
            if (!doRegister) {
              clack.outro(c.dim("Setup cancelled."));
              result.ok = false;
              return result;
            }

            let regPassword = password;
            if (regPassword.length < 8) {
              clack.log.warn("Password must be at least 8 characters.");
              regPassword = await clack.password({
                message: "Password (min 8 chars)",
                validate(value) {
                  if (!value || value.length < 8)
                    return "Password must be at least 8 characters.";
                },
              });
              handleCancel(regPassword);
            }
            const confirmPw = await clack.password({
              message: "Confirm password",
              validate(value) {
                if (value !== regPassword) return "Passwords do not match.";
              },
            });
            handleCancel(confirmPw);

            const regName = await clack.text({
              message: "Name (optional)",
              placeholder: "Press Enter to skip",
            });
            handleCancel(regName);

            const s2 = clack.spinner();
            s2.start("Registering...");
            const regResult = await cliLogin(
              serverUrl,
              email,
              regPassword,
              true,
              regName || undefined
            );
            if (regResult.ok) {
              token = regResult.token;
              s2.stop(
                `Account created for ${c.cyan(regResult.user.email)}`
              );
            } else {
              s2.stop(c.red("Registration failed."));
              clack.log.error(regResult.error);
              clack.outro(c.red("Setup failed."));
              result.ok = false;
              return result;
            }
          } else {
            s.stop(c.red("Authentication failed."));
            clack.log.error(loginResult.error);
            clack.outro(c.red("Setup failed."));
            result.ok = false;
            return result;
          }
        } else {
          // No password — new account registration
          clack.log.info(`Creating a new account for ${c.cyan(email)}`);
          const regPassword = await clack.password({
            message: "Set password (min 8 chars)",
            validate(value) {
              if (!value || value.length < 8)
                return "Password must be at least 8 characters.";
            },
          });
          handleCancel(regPassword);
          const confirmPw = await clack.password({
            message: "Confirm password",
            validate(value) {
              if (value !== regPassword) return "Passwords do not match.";
            },
          });
          handleCancel(confirmPw);
          const regName = await clack.text({
            message: "Name (optional)",
            placeholder: "Press Enter to skip",
          });
          handleCancel(regName);

          const s = clack.spinner();
          s.start("Registering...");
          const regResult = await cliLogin(
            serverUrl,
            email,
            regPassword,
            true,
            regName || undefined
          );
          if (regResult.ok) {
            token = regResult.token;
            s.stop(
              `Account created for ${c.cyan(regResult.user.email)}`
            );
          } else {
            s.stop(c.red("Registration failed."));
            clack.log.error(regResult.error);
            clack.outro(c.red("Setup failed."));
            result.ok = false;
            return result;
          }
        }
      } else {
        // Manual token paste
        const tokenInput = await clack.password({
          message: "API Token",
          validate(value) {
            if (!value && !existingToken) return "Token is required.";
          },
        });
        handleCancel(tokenInput);
        token = tokenInput || existingToken;
        if (!tokenInput && existingToken) {
          clack.log.info("Keeping existing token.");
        }
      }
    }

    if (!token && !options["skip-validate"]) {
      clack.log.error("Token is required. Use --token or --skip-validate.");
      clack.outro(c.red("Setup failed."));
      result.ok = false;
      process.exitCode = 2;
      return result;
    }
    config.server.token = token || "";

    // --- Step 3: Device Name ---
    const defaultDevice = config.server.deviceId || os.hostname();
    let deviceId;
    if (options.device) {
      deviceId = options.device;
    } else {
      const answer = await clack.text({
        message: "Device name",
        placeholder: defaultDevice,
        defaultValue: defaultDevice,
      });
      handleCancel(answer);
      deviceId = answer;
    }
    config.server.deviceId = deviceId;

    // --- Save config before migration ---
    if (!options["dry-run"]) {
      saveConfig(config);
    }

    // --- DB Migrate ---
    if (!options["dry-run"]) {
      const s = clack.spinner();
      s.start("Migrating database...");
      try {
        const { migrateDatabase } = require("./migrate");
        const dbResult = migrateDatabase(config);
        result.db = dbResult;
        s.stop(`Database migrated ${c.dim(`(schema v${dbResult.version})`)}`);
      } catch (err) {
        result.db = { error: err.message };
        s.stop(c.red("Database migration failed."));
        clack.log.error(`Database error: ${err.message}`);
      }
    } else {
      clack.log.info(c.dim("[dry-run] Would migrate database."));
      result.db = { dryRun: true };
    }

    // --- Step 4: Install Hooks ---
    const cliTargets = resolveCliTargets(options);

    if (cliTargets.length === 0 && !options["no-hooks"]) {
      clack.log.warn(
        "No supported CLI tools detected (claude, codex, gemini, opencode)."
      );
      clack.log.info(
        c.dim("Install hooks later with: omp install <cli>")
      );
    } else if (options["no-hooks"]) {
      clack.log.info(c.dim("Hook installation skipped (--no-hooks)."));
    } else {
      // Build options for multiselect
      const detected = detectClis();
      const hookOptions = cliTargets.map((cli) => ({
        value: cli,
        label: cliDisplayName(cli),
        hint: detected.includes(cli) ? "detected" : "not found",
      }));

      const selectedHooks = await clack.multiselect({
        message: "Install hooks",
        options: hookOptions,
        initialValues: cliTargets,
        required: false,
      });
      handleCancel(selectedHooks);

      const {
        installClaudeHook,
        installCodexHook,
        installGeminiHook,
        installOpenCodeHook,
      } = require("./hooks");

      if (selectedHooks.length > 0) {
        const s = clack.spinner();
        s.start("Installing hooks...");

        for (const cli of selectedHooks) {
          if (options["dry-run"]) {
            result.hooks[cli] = { installed: false, dryRun: true };
            continue;
          }

          try {
            if (cli === "claude") {
              const hookPath = installClaudeHook();
              config.hooks.enabled.claude_code = true;
              result.hooks.claude = { installed: true, path: hookPath };
            } else if (cli === "codex") {
              const codexResult = installCodexHook();
              config.hooks.enabled.codex = codexResult.configured;
              result.hooks.codex = {
                installed: codexResult.configured,
                path: codexResult.scriptPath,
                configPath: codexResult.configPath,
                merged: codexResult.merged,
                conflict: codexResult.conflict,
              };
            } else if (cli === "gemini") {
              const geminiResult = installGeminiHook();
              config.hooks.enabled.gemini = geminiResult.configured;
              result.hooks.gemini = {
                installed: geminiResult.configured,
                path: geminiResult.scriptPath,
                configPath: geminiResult.settingsPath,
              };
            } else if (cli === "opencode") {
              const opencodeResult = installOpenCodeHook();
              config.hooks.enabled.opencode = opencodeResult.configured;
              result.hooks.opencode = {
                installed: opencodeResult.configured,
                path: opencodeResult.scriptPath,
                configPath: opencodeResult.configPath,
                conflict: opencodeResult.conflict,
              };
            }
          } catch (err) {
            result.hooks[cli] = { installed: false, error: err.message };
          }
        }

        // Save updated hook config
        if (!options["dry-run"]) {
          saveConfig(config);
        }

        const installed = selectedHooks.filter(
          (cli) => result.hooks[cli]?.installed
        );
        const failed = selectedHooks.filter(
          (cli) => result.hooks[cli]?.error
        );

        if (failed.length) {
          s.stop(
            c.yellow(
              `Hooks installed with issues (${installed.length}/${selectedHooks.length})`
            )
          );
          for (const cli of failed) {
            clack.log.error(
              `${cliDisplayName(cli)}: ${result.hooks[cli].error}`
            );
          }
        } else {
          s.stop(
            `Hooks installed ${c.dim(`(${installed.map((cli) => cliDisplayName(cli)).join(", ")})`)}`
          );
        }

        // Show conflicts/merges
        if (result.hooks.codex?.conflict) {
          clack.log.warn(
            "Codex notify is already configured by another tool."
          );
        }
        if (result.hooks.codex?.merged) {
          clack.log.info("Codex notify merged via wrapper script.");
        }
        if (result.hooks.opencode?.conflict) {
          clack.log.warn(
            "OpenCode config has non-array 'plugin' field."
          );
        }
      } else {
        // No hooks selected
        for (const cli of cliTargets) {
          result.hooks[cli] = { installed: false, skipped: true };
        }
        clack.log.info(c.dim("No hooks selected."));
      }
    }

    // --- Validate Server ---
    if (
      !options["skip-validate"] &&
      !options["dry-run"] &&
      config.server.token
    ) {
      const s = clack.spinner();
      s.start("Validating server...");

      const validation = await validateToken(
        config.server.url,
        config.server.token,
        config.server.deviceId
      );
      result.validation = validation;

      if (validation.valid) {
        s.stop(`Server validated ${c.dim(`(${validation.status})`)}`);
      } else {
        s.stop(c.red("Server validation failed."));
        clack.log.error(validation.error || "Unknown error");

        if (validation.status === 401 || validation.status === 403) {
          let retries = 2;
          let lastValidation = validation;
          while (retries > 0 && !lastValidation.valid) {
            const retry = await clack.confirm({
              message: "Re-enter token?",
              initialValue: true,
            });
            handleCancel(retry);
            if (!retry) break;
            const newToken = await clack.password({
              message: "API Token",
            });
            handleCancel(newToken);
            if (newToken) {
              config.server.token = newToken;
              saveConfig(config);
              const s2 = clack.spinner();
              s2.start("Validating...");
              const retryResult = await validateToken(
                config.server.url,
                newToken,
                config.server.deviceId
              );
              if (retryResult.valid) {
                s2.stop(
                  `Server validated ${c.dim(`(${retryResult.status})`)}`
                );
                result.validation = retryResult;
                lastValidation = retryResult;
                break;
              } else {
                s2.stop(c.red("Validation failed."));
                clack.log.error(retryResult.error || "Unknown error");
                result.validation = retryResult;
                lastValidation = retryResult;
              }
            }
            retries--;
          }
        } else {
          clack.log.info(
            c.dim(
              "Setup saved locally. Sync will work once the server is available."
            )
          );
        }
      }
    } else if (options["skip-validate"]) {
      result.validation = {
        valid: true,
        status: null,
        error: null,
        skipped: true,
      };
      clack.log.info(c.dim("Server validation skipped (--skip-validate)."));
    } else if (options["dry-run"]) {
      result.validation = {
        valid: true,
        status: null,
        error: null,
        dryRun: true,
      };
    }

    // --- Final output ---
    result.config = {
      serverUrl: config.server.url,
      deviceId: config.server.deviceId,
      sqlitePath: config.storage.sqlite.path,
    };

    const validationOk = !result.validation || result.validation.valid;
    result.ok = validationOk;

    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      // Summary note box
      const installedHooks = Object.entries(result.hooks)
        .filter(([, v]) => v.installed)
        .map(([k]) => k);

      clack.note(
        [
          `${c.dim("Server:")}  ${c.cyan(config.server.url)}`,
          `${c.dim("Device:")}  ${config.server.deviceId}`,
          `${c.dim("Hooks:")}   ${installedHooks.length ? installedHooks.join(", ") : c.dim("none")}`,
        ].join("\n"),
        "Setup Complete"
      );

      clack.outro(
        `Run ${c.cyan("omp backfill")} to import existing prompts`
      );
    }

    return result;
  }

  // --- Non-interactive path (--yes or piped input) ---
  const output = process.stdout;

  const defaultUrl = config.server.url || "https://prompt.jiun.dev";
  const serverUrl = normalizeUrl(options.server || defaultUrl);
  config.server.url = serverUrl;

  const existingToken = config.server.token;
  const token = options.token || existingToken;
  if (!token && !options["skip-validate"]) {
    output.write("Error: Token is required. Use --token or --skip-validate.\n");
    result.ok = false;
    process.exitCode = 2;
    return result;
  }
  config.server.token = token || "";

  const defaultDevice = config.server.deviceId || os.hostname();
  config.server.deviceId = options.device || defaultDevice;

  if (!options["dry-run"]) {
    saveConfig(config);
  }

  // DB Migrate
  if (!options["dry-run"]) {
    try {
      const { migrateDatabase } = require("./migrate");
      const dbResult = migrateDatabase(config);
      result.db = dbResult;
    } catch (err) {
      result.db = { error: err.message };
    }
  } else {
    result.db = { dryRun: true };
  }

  // Install Hooks
  const cliTargets = resolveCliTargets(options);
  if (cliTargets.length > 0 && !options["no-hooks"]) {
    const {
      installClaudeHook,
      installCodexHook,
      installGeminiHook,
      installOpenCodeHook,
    } = require("./hooks");

    for (const cli of cliTargets) {
      if (options["dry-run"]) {
        result.hooks[cli] = { installed: false, dryRun: true };
        continue;
      }
      try {
        if (cli === "claude") {
          const hookPath = installClaudeHook();
          config.hooks.enabled.claude_code = true;
          result.hooks.claude = { installed: true, path: hookPath };
        } else if (cli === "codex") {
          const codexResult = installCodexHook();
          config.hooks.enabled.codex = codexResult.configured;
          result.hooks.codex = {
            installed: codexResult.configured,
            path: codexResult.scriptPath,
            configPath: codexResult.configPath,
            merged: codexResult.merged,
            conflict: codexResult.conflict,
          };
        } else if (cli === "gemini") {
          const geminiResult = installGeminiHook();
          config.hooks.enabled.gemini = geminiResult.configured;
          result.hooks.gemini = {
            installed: geminiResult.configured,
            path: geminiResult.scriptPath,
            configPath: geminiResult.settingsPath,
          };
        } else if (cli === "opencode") {
          const opencodeResult = installOpenCodeHook();
          config.hooks.enabled.opencode = opencodeResult.configured;
          result.hooks.opencode = {
            installed: opencodeResult.configured,
            path: opencodeResult.scriptPath,
            configPath: opencodeResult.configPath,
            conflict: opencodeResult.conflict,
          };
        }
      } catch (err) {
        result.hooks[cli] = { installed: false, error: err.message };
      }
    }

    if (!options["dry-run"]) {
      saveConfig(config);
    }
  }

  // Validate Server
  if (
    !options["skip-validate"] &&
    !options["dry-run"] &&
    config.server.token
  ) {
    const validation = await validateToken(
      config.server.url,
      config.server.token,
      config.server.deviceId
    );
    result.validation = validation;
  } else if (options["skip-validate"]) {
    result.validation = {
      valid: true,
      status: null,
      error: null,
      skipped: true,
    };
  } else if (options["dry-run"]) {
    result.validation = {
      valid: true,
      status: null,
      error: null,
      dryRun: true,
    };
  }

  // Doctor
  try {
    const { runDoctor } = require("./doctor");
    result.doctor = runDoctor(config);
  } catch (err) {
    result.doctor = { ok: false, errors: [err.message], warnings: [] };
  }

  result.config = {
    serverUrl: config.server.url,
    deviceId: config.server.deviceId,
    sqlitePath: config.storage.sqlite.path,
  };

  const validationOk = !result.validation || result.validation.valid;
  result.ok = validationOk;

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }

  return result;
}

module.exports = { runSetup };
