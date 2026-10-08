import { createContext } from 'react';
import type { AppLocation } from '@/renderer/components/app/app-navigation';

export const ContentSearchTargetContext = createContext<AppLocation['contentSearchTarget']>(undefined);
