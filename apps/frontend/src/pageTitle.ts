export const BASE_DOCUMENT_TITLE = "Veydrift";

type TitleDocument = {
  title: string;
};

export function resetDocumentTitle(documentRef: TitleDocument | undefined = currentDocument()): void {
  if (!documentRef) return;
  documentRef.title = BASE_DOCUMENT_TITLE;
}

function currentDocument(): TitleDocument | undefined {
  return typeof document === "undefined" ? undefined : document;
}
