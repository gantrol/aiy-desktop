import { contextBridge } from 'electron';
import { createDesktopPetalsApi } from '@/preload/desktop-petals-api';
contextBridge.exposeInMainWorld('desktopPetals', createDesktopPetalsApi());
