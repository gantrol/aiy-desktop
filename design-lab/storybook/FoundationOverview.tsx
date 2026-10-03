import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  ButtonExample,
  buttonDisabledArgs,
  buttonExamples,
  buttonSizes,
  InputExample,
  inputExamples,
} from './FoundationSamples';
import { StoryLink } from './StoryLink';

function InputStates() {
  const { navigation } = useI18n().messages.designLab.storybook;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-x-8 gap-y-6">
      {Object.values(inputExamples).map(({ storyId, name, args }) => (
        <div key={storyId} className="min-w-0 space-y-3">
          <div className="text-sm text-muted-foreground">
            <StoryLink storyId={storyId}>{navigation[name]}</StoryLink>
          </div>
          <InputExample {...args} aria-label={`${navigation.Input} · ${navigation[name]}`} />
        </div>
      ))}
    </div>
  );
}

export function FoundationOverview() {
  const { foundation, navigation } = useI18n().messages.designLab.storybook;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 p-6 sm:p-8">
      <h1 className="text-lg font-semibold">{navigation.Interface}</h1>
      <section className="space-y-5">
        <h2 className="border-b pb-3 text-base font-semibold">
          <StoryLink storyId="ui-button--overview">{navigation.Button}</StoryLink>
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-8 gap-y-6">
          {Object.values(buttonExamples).map(({ storyId, args }) => (
            <div key={storyId} className="space-y-3">
              <div className="text-sm text-muted-foreground">
                <StoryLink storyId={storyId}>{foundation.variants[args.variant]}</StoryLink>
              </div>
              <ButtonExample {...args} />
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-5">
        <h2 className="border-b pb-3 text-base font-semibold">
          <StoryLink storyId="ui-input--overview">{navigation.Input}</StoryLink>
        </h2>
        <InputStates />
      </section>
    </main>
  );
}

export function ButtonOverview() {
  const { foundation, navigation } = useI18n().messages.designLab.storybook;
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6 sm:p-8">
      <h1 className="text-lg font-semibold">{navigation.Button}</h1>
      <Table className="min-w-[26rem]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="w-1/3">
              {foundation.appearance}
            </TableHead>
            <TableHead scope="col" className="w-1/3">
              {navigation.Default}
            </TableHead>
            <TableHead scope="col" className="w-1/3">
              <StoryLink storyId="ui-button--b-02">{navigation.Disabled}</StoryLink>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.values(buttonExamples).map(({ storyId, args }) => (
            <TableRow key={storyId} className="hover:bg-transparent">
              <TableHead scope="row" className="h-16 font-normal">
                <StoryLink storyId={storyId}>{foundation.variants[args.variant]}</StoryLink>
              </TableHead>
              <TableCell className="h-16">
                <ButtonExample {...args} />
              </TableCell>
              <TableCell className="h-16">
                <ButtonExample {...args} disabled={buttonDisabledArgs.disabled} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <section className="space-y-5">
        <h2 className="text-sm font-semibold">{foundation.sizes}</h2>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-6">
          {buttonSizes.map((size) => (
            <div key={size} className="space-y-3">
              <div className="text-xs text-muted-foreground">{foundation.sizeLabels[size]}</div>
              <div className="flex h-10 items-center">
                <ButtonExample {...buttonExamples.primary.args} size={size} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export function InputOverview() {
  const { navigation } = useI18n().messages.designLab.storybook;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 p-6 sm:p-8">
      <h1 className="text-lg font-semibold">{navigation.Input}</h1>
      <InputStates />
    </main>
  );
}
