export interface SyncFileAttr { 
    docName: string; 
    /** 0: folder 1: tex file 2: project */
    docType?: number;
    projectId: string;
    docIntId?: string;
    curTime?: string;
    hash?: string;
}