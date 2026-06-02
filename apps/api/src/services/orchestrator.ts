const AI_BASE_URL = process.env.AI_BASE_URL || "http://localhost:8080";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";

export class OrchestratorService {
  public async submitJob(sheetId: string, userId: string, audioPath: string, instrument: string) {
    const res = await fetch(`${AI_BASE_URL}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        sheet_id: sheetId,
        user_id: userId,
        audio_path: audioPath,
        instrument,
      }),
    });

    if (!res.ok) {
      throw new Error(`Orchestrator error: ${res.statusText}`);
    }

    return (await res.json()) as { job_id: string; status: string };
  }

  public async getJobStatus(jobId: string) {
    const res = await fetch(`${AI_BASE_URL}/jobs/${jobId}`, {
      headers: {
        "X-Internal-Token": INTERNAL_TOKEN,
      },
    });

    if (!res.ok) {
      throw new Error(`Orchestrator error: ${res.statusText}`);
    }

    return await res.json();
  }

  public async deleteJob(jobId: string) {
    const res = await fetch(`${AI_BASE_URL}/jobs/${jobId}`, {
      method: "DELETE",
      headers: {
        "X-Internal-Token": INTERNAL_TOKEN,
      },
    });

    if (!res.ok) {
      throw new Error(`Orchestrator error: ${res.statusText}`);
    }

    return await res.json();
  }

  public streamJobProgress(
    jobId: string,
    onEvent: (event: any) => void,
    onError: (err: any) => void
  ): AbortController {
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(`${AI_BASE_URL}/jobs/${jobId}/stream`, {
          headers: {
            "Accept": "text/event-stream",
            "X-Internal-Token": INTERNAL_TOKEN,
          },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`SSE stream error: ${res.statusText}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const cleanLine = line.trim();
            if (cleanLine.startsWith("data:")) {
              const dataStr = cleanLine.slice(5).trim();
              try {
                onEvent(JSON.parse(dataStr));
              } catch {}
            } else if (cleanLine && !cleanLine.startsWith(":")) {
              try {
                onEvent(JSON.parse(cleanLine));
              } catch {}
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          onError(err);
        }
      }
    })();

    return controller;
  }
}

export const orchestrator = new OrchestratorService();
