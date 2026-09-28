import { useI18n } from '@/renderer/i18n/useI18n';

export function useWorkspaceTabLabels() {
  const { messages } = useI18n();
  const navigation = messages.app.navigation;
  return {
    labels: messages.app.workspace,
    navigation,
    titleLabels: {
      animation: messages.creator.gifMaker.workspaceTitle,
      outline: messages.creator.outline.title,
      views: { ...navigation, contentManagement: navigation.settings },
      newCreation: messages.creator.results.newCreation,
      creationKinds: messages.contentManagement.subtypes,
    },
  };
}
