import * as zip from 'fflate'
import { createWorkspaceArchive } from './workspace-archive.js'
import { imageStorage } from './database'
import { createJsonBlob } from '../utils/json-export'
import { readWorkspaceJson } from '../utils/json-import'
import { chatDocuments } from '../api/chat-files.js'

export const workspaceArchive = createWorkspaceArchive(
  zip,
  imageStorage,
  createJsonBlob,
  readWorkspaceJson,
  chatDocuments,
)
