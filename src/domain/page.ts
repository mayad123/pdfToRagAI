/** One PDF page with 1-based page number and raw or cleaned text. */
export interface Page {
  pageNumber: number;
  text: string;
}
