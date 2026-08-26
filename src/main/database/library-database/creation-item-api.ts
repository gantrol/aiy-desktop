import type {
  CreationFormAddOrGetInput,
  CreationItemGetInput,
  CreationItemListInput,
  CreationItemMoveInput,
  CreationItemSetPinnedInput,
  CreationItemSetPrimaryInput,
  CreationItemCreateWithFormInput,
} from '@/shared/contracts/creation-library';
import type { CreationItemRepository } from '@/main/database/creations/creation-item-repository';

export function createCreationItemApi(repositories: { creationItems: CreationItemRepository }) {
  return {
    listCreationItems(input: CreationItemListInput = {}) {
      return repositories.creationItems.list(input);
    },

    getCreationItem(input: CreationItemGetInput) {
      return repositories.creationItems.find(input.creationItemId);
    },

    createCreationItemWithForm(input: CreationItemCreateWithFormInput) {
      return repositories.creationItems.createWithForm(input);
    },

    addOrGetCreationForm(input: CreationFormAddOrGetInput) {
      return repositories.creationItems.addOrGetForm(input);
    },

    moveCreationItem(input: CreationItemMoveInput) {
      return repositories.creationItems.move(input);
    },

    setCreationItemPinned(input: CreationItemSetPinnedInput) {
      return repositories.creationItems.setPinned(input);
    },

    setCreationItemPrimaryForm(input: CreationItemSetPrimaryInput) {
      return repositories.creationItems.setPrimary(input);
    },
  };
}
