import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/renderer/lib/utils';
import { Label } from '@/renderer/components/ui/label';

interface FieldContextValue {
  controlId: string;
  labelId: string;
  descriptionId: string;
  errorId: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = React.createContext<FieldContextValue | null>(null);

function useFieldContext(component: string) {
  const context = React.useContext(FieldContext);
  if (!context) throw new Error(`${component} must be used inside Field`);
  return context;
}

interface FieldProps extends Omit<React.ComponentProps<'div'>, 'id'> {
  id?: string;
  invalid?: boolean;
}

function containsFieldPart(children: React.ReactNode, component: React.ElementType): boolean {
  return React.Children.toArray(children).some(
    (child) =>
      React.isValidElement<{ children?: React.ReactNode }>(child) &&
      ((child.type === component && (component !== FieldError || Boolean(child.props.children))) ||
        (child.type === React.Fragment && containsFieldPart(child.props.children, component))),
  );
}

function Field({ id, invalid = false, className, children, ...props }: FieldProps) {
  const generatedId = React.useId().replaceAll(':', '');
  const controlId = id ?? `field-${generatedId}`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy =
    [containsFieldPart(children, FieldDescription) && descriptionId, containsFieldPart(children, FieldError) && errorId]
      .filter(Boolean)
      .join(' ') || undefined;
  const context = React.useMemo(
    () => ({
      controlId,
      labelId: `${controlId}-label`,
      descriptionId,
      errorId,
      describedBy,
      invalid,
    }),
    [controlId, describedBy, descriptionId, errorId, invalid],
  );

  return (
    <FieldContext.Provider value={context}>
      <div
        data-slot="field"
        data-invalid={invalid || undefined}
        className={cn('group/field grid gap-1.5', className)}
        {...props}
      >
        {children}
      </div>
    </FieldContext.Provider>
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  const { controlId, labelId } = useFieldContext('FieldLabel');
  return (
    <Label {...props} data-slot="field-label" id={labelId} htmlFor={controlId} className={cn('text-sm', className)} />
  );
}

interface FieldControlProps extends Omit<React.ComponentProps<typeof Slot>, 'children'> {
  children: React.ReactElement;
}

function FieldControl({ children, ...props }: FieldControlProps) {
  const { controlId, labelId, describedBy, invalid } = useFieldContext('FieldControl');
  return (
    <Slot
      {...props}
      data-slot="field-control"
      id={controlId}
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
    >
      {children}
    </Slot>
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { descriptionId } = useFieldContext('FieldDescription');
  return (
    <p
      {...props}
      data-slot="field-description"
      id={descriptionId}
      className={cn('text-xs leading-relaxed text-muted-foreground', className)}
    />
  );
}

function FieldError({ className, children, ...props }: React.ComponentProps<'p'>) {
  const { errorId } = useFieldContext('FieldError');
  if (!children) return null;
  return (
    <p
      {...props}
      data-slot="field-error"
      id={errorId}
      role="alert"
      className={cn('text-xs leading-relaxed text-destructive', className)}
    >
      {children}
    </p>
  );
}

export { Field, FieldControl, FieldDescription, FieldError, FieldLabel };
