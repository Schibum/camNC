// Auto-generated api client for WebUI 3.0:
// https://chatgpt.com/share/67d9c76e-5424-8000-8514-1f677b90b99f
// Also see here: https://esp3d.io/ESP3D/Version_3.X/documentation/api/webhandlers/
// And here: https://github.com/luc-github/ESP3D-WEBUI/blob/3.0/extensions_samples/API.md

export interface ModalConfig {
  title: string;
  id: string; // e.g. 'simple_modal', 'confirm_modal', etc.
  style: "default" | "question" | "input" | "fields";
  bt1Txt?: string;
  response1?: string;
  bt2Txt?: string;
  response2?: string;
  hideclose?: boolean;
  overlay?: boolean;
  text?: string;
  validation?: "bt1" | "bt2";
  fields?: any[];
}

interface PendingRequest {
  resolve: (data: any) => void;
  reject: (error: any) => void;
  timeout: number;
  progressCallback?: (progress: number) => void;
  type: string;
}

async function readBlobAsString(blob: Blob) {
  let reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/**
 * Esp3dApi wraps communication with the WebUI using postMessage.
 * It implements all the documented API methods:
 *
 *  - GCODE/ESP command: cmd()
 *  - Web query: query()
 *  - Web upload: upload()
 *  - Web download: download()
 *  - Sound notification: sound()
 *  - Toast notification: toast()
 *  - Translation request: translate() and translateAll()
 *  - Capabilities request: capabilities()
 *  - Save extension settings: saveExtensionSettings()
 *  - Icon request: icon()
 *  - Dispatch message: dispatch()
 *  - Modal dialogs: modal()
 *
 * All methods that expect a response return a Promise that resolves
 * when a matching response is received.
 */
export class FluidncApi {
  // Map to hold pending requests keyed by unique id.
  private static pendingRequests: Map<string, PendingRequest> = new Map();

  /**
   * @param responseTimeout Timeout in milliseconds to wait for a response (default: 5000 ms)
   */
  constructor(private responseTimeout: number = 5000) {
    window.addEventListener("message", this.handleMessage.bind(this));
  }

  /**
   * Handles incoming messages and routes responses to the corresponding pending request.
   */
  private handleMessage(event: MessageEvent): void {
    const message = event.data;
    if (!message || !message.id) return;

    const pending = FluidncApi.pendingRequests.get(message.id);
    if (!pending) return;

    // Response can be in "content" or "response"
    const responseData = message.content || message.response;
    if (!responseData) return;

    // Check for progress, success, or error status.
    if (responseData.status) {
      if (responseData.status === "progress") {
        if (
          pending.progressCallback &&
          typeof responseData.progress !== "undefined"
        ) {
          pending.progressCallback(Number(responseData.progress));
        }
        // Keep waiting for the final message.
        return;
      } else if (responseData.status === "success") {
        let data = responseData.response;
        if (typeof data === "string") {
          try {
            data = JSON.parse(data);
          } catch {
            // Leave as string if JSON parsing fails.
          }
        }
        pending.resolve(data);
      } else if (responseData.status === "error") {
        pending.reject(responseData.error || "Unknown error");
      }
    } else {
      // For responses without a status property (e.g. modal or translation).
      pending.resolve(responseData.response || responseData);
    }

    clearTimeout(pending.timeout);
    FluidncApi.pendingRequests.delete(message.id);
  }

  /**
   * Sends a message that expects a response and returns a Promise.
   *
   * @param message The message object.
   * @param progressCallback Optional callback for progress updates.
   */
  private sendRequest(
    message: any,
    progressCallback?: (progress: number) => void
  ): Promise<any> {
    message.id = this.generateUniqueId();
    const id = message.id;
    return new Promise<any>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        FluidncApi.pendingRequests.delete(id);
        reject(new Error("Timeout waiting for response"));
      }, this.responseTimeout);
      FluidncApi.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
        progressCallback,
        type: message.type,
      });
      window.parent.postMessage(message, "*");
    });
  }

  /**
   * Sends a message that does not expect a response.
   *
   * @param message The message object.
   */
  private sendMessage(message: any): void {
    message.id = this.generateUniqueId();
    window.parent.postMessage(message, "*");
  }

  /**
   * Generates a unique id to correlate requests and responses.
   */
  private generateUniqueId(): string {
    return "req_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  /* ====================================
     API Methods Returning a Response
  ===================================== */

  /**
   * Sends a GCODE/ESP command.
   *
   * @param content The command string (e.g. "[ESP111]").
   * @returns A Promise that resolves with the command response.
   */
  public cmd(content: string): Promise<any> {
    console.warn("CMD called", content);
    const message = {
      type: "cmd",
      target: "webui",
      content,
    };
    return this.sendRequest(message);
  }

  /**
   * Sends a web query.
   *
   * @param url The base URL (e.g. "files").
   * @param args The query arguments (e.g. { action: "list", path: "/" }).
   * @returns A Promise that resolves with the query result.
   */
  public query(url: string, args: any): Promise<any> {
    const message = {
      type: "query",
      target: "webui",
      url,
      args,
    };
    return this.sendRequest(message);
  }

  /**
   * Sends a web upload request.
   *
   * @param content The file content (as an array or other representation).
   * @param size The file size.
   * @param path The target directory path (excluding filename).
   * @param filename The name of the file.
   * @param args Optional additional arguments.
   * @param progressCallback Optional callback for progress updates.
   * @returns A Promise that resolves with the upload response.
   */
  public upload(
    content: any,
    path: string,
    filename: string,
    progressCallback?: (progress: number) => void
  ): Promise<any> {
    const message = {
      type: "upload",
      target: "webui",
      url: "/sdfiles",
      content,
      size: content.length,
      path,
      filename,
    };
    return this.sendRequest(message, progressCallback);
  }

  /**
   * Sends a web download request.
   *
   * @param url The URL of the file to download (e.g. "preferences.json").
   * @param args Optional query arguments.
   * @param progressCallback Optional callback for progress updates.
   * @returns A Promise that resolves with the downloaded file (e.g. as a blob).
   */
  public async download(
    url: string,
    args?: any,
    progressCallback?: (progress: number) => void
  ): Promise<string> {
    const message = {
      type: "download",
      target: "webui",
      url,
      args,
    };
    let blob = await this.sendRequest(message, progressCallback);
    return readBlobAsString(blob);
  }

  /**
   * Sends a translation request for a single text.
   *
   * @param text The text to translate (e.g. "S153").
   * @returns A Promise that resolves with the translated text.
   */
  public translate(text: string): Promise<any> {
    const message = {
      type: "translate",
      target: "webui",
      content: text,
    };
    return this.sendRequest(message);
  }

  /**
   * Requests a full dump of translations.
   *
   * @returns A Promise that resolves with all translations.
   */
  public translateAll(): Promise<any> {
    const message = {
      type: "translate",
      target: "webui",
      all: "true",
    };
    return this.sendRequest(message);
  }

  /**
   * Sends a capabilities request.
   *
   * @param capability The capability to query (e.g. "connection", "features", "interface", "settings", "extensions").
   * @returns A Promise that resolves with the capabilities response.
   */
  public capabilities(capability: string): Promise<any> {
    const message = {
      type: "capabilities",
      target: "webui",
      // Although the docs use the capability as the id, we auto-generate one.
      // The backend should echo the same id as sent.
      capability,
    };
    return this.sendRequest(message);
  }

  /**
   * Saves extension settings to preferences.json.
   *
   * @param settings An object with settings to save.
   * @returns A Promise that resolves with the save status.
   */
  public saveExtensionSettings(settings: object): Promise<any> {
    const message = {
      type: "extensionsData",
      target: "webui",
      content: JSON.stringify(settings),
    };
    return this.sendRequest(message);
  }

  /**
   * Requests an icon.
   *
   * @param iconName The icon identifier (e.g. "Activity").
   * @returns A Promise that resolves with the SVG icon string.
   */
  public icon(iconName: string): Promise<any> {
    const message = {
      type: "icon",
      target: "webui",
      // Instead of a custom id, the icon name is passed in the message.
      icon: iconName,
    };
    return this.sendRequest(message);
  }

  /**
   * Opens a modal dialog.
   *
   * @param config The modal configuration.
   * @returns A Promise that resolves with the modal response.
   */
  public modal(config: ModalConfig): Promise<any> {
    const message = {
      type: "modal",
      target: "webui",
      content: config,
    };
    return this.sendRequest(message);
  }

  /* ====================================
     API Methods Without a Response
  ===================================== */

  /**
   * Sends a sound notification.
   *
   * @param content The sound type (e.g. "beep" or "error").
   * @param seq Optional sequence for beep notifications.
   */
  public sound(content: string, seq?: Array<{ f: number; d: number }>): void {
    const message: any = {
      type: "sound",
      target: "webui",
      content,
    };
    if (seq) {
      message.seq = seq;
    }
    this.sendMessage(message);
  }

  /**
   * Sends a toast notification.
   *
   * @param toastContent An object with toast text and type (e.g. { text: "This is a success", type: "success" }).
   */
  public toast(toastContent: {
    text: string;
    type: "success" | "error" | "default";
  }): void {
    const message = {
      type: "toast",
      target: "webui",
      content: toastContent,
    };
    this.sendMessage(message);
  }

  /**
   * Dispatches a message to another extension.
   *
   * @param content The message content.
   * @param targetId The target extension's identifier.
   */
  public dispatch(content: any, targetId: string): void {
    const message = {
      type: "dispatch",
      target: "webui",
      content,
      targetid: targetId,
    };
    this.sendMessage(message);
  }
}
