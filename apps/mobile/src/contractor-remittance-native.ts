import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { mobileFetch } from "@/api";
import {
  ContractorRemittanceError,
  downloadContractorRemittance,
  type ContractorRemittanceDownloadResponse,
  type ContractorRemittanceTarget,
} from "@/contractor-remittance";

async function send(path: string): Promise<ContractorRemittanceDownloadResponse> {
  const response = await mobileFetch(path, { headers: { accept: "application/pdf" } });
  if (!response.ok) {
    let errorBody: unknown = null;
    try {
      errorBody = await response.json();
    } catch {
      // The typed downloader maps an unreadable error response to unavailable.
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      contentDisposition: response.headers.get("content-disposition"),
      body: null,
      errorBody,
    };
  }
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    contentDisposition: response.headers.get("content-disposition"),
    body: new Uint8Array(await response.arrayBuffer()),
    errorBody: null,
  };
}

export async function shareContractorRemittance(target: ContractorRemittanceTarget): Promise<void> {
  await downloadContractorRemittance(target, {
    send,
    save: async (filename, body) => {
      const file = new File(Paths.cache, filename);
      file.create({ intermediates: true, overwrite: true });
      try {
        await file.write(body);
      } catch (error) {
        if (file.exists) file.delete();
        throw error;
      }
      return {
        uri: file.uri,
        remove: async () => { if (file.exists) file.delete(); },
      };
    },
    share: async (uri, filename) => {
      if (!(await Sharing.isAvailableAsync())) throw new ContractorRemittanceError("sharing_unavailable");
      await Sharing.shareAsync(uri, {
        dialogTitle: `Open or save ${filename}`,
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
      });
    },
  });
}
