# Validation Chain

interface ValidationChain<T> {
  required(): ValidationChain<T>;
  string(): ValidationChain<string>;
  number(): ValidationChain<number>;
  email(): ValidationChain<string>;
  minLength(min: number): ValidationChain<string>;
  maxLength(max: number): ValidationChain<string>;
  pattern(regex: RegExp): ValidationChain<string>;
  custom(validator: (value: T) => boolean): ValidationChain<T>;
  validate(value: T): ValidationResult;
}