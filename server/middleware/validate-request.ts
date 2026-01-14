import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Generic validation middleware factory
 * Validates req.body against a Zod schema and returns detailed field-level errors
 */
export function validateRequest(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate and parse the request body
      const validatedData = schema.parse(req.body);
      
      // Replace req.body with validated data (ensures type safety and removes extra fields)
      req.body = validatedData;
      
      // Continue to next middleware/handler
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Format Zod errors into detailed field-level error object
        const errorDetails: Record<string, string> = {};
        
        error.errors.forEach((err) => {
          const path = err.path.join('.');
          // If multiple errors for same field, combine them
          if (errorDetails[path]) {
            errorDetails[path] += `; ${err.message}`;
          } else {
            errorDetails[path] = err.message;
          }
        });
        
        // Return 400 Bad Request with detailed error information
        return res.status(400).json({
          error: 'Validation failed',
          details: errorDetails,
        });
      }
      
      // If it's not a ZodError, pass it to the error handler
      next(error);
    }
  };
}
