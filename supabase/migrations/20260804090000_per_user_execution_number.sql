-- Migration: Scoped auto-incremental execution number per user_id

-- 1. Remove identity property from number column if previously set as global identity
ALTER TABLE public.executions
  ALTER COLUMN number DROP IDENTITY IF EXISTS;

-- 2. Create function to set execution number scoped per user_id before insert
CREATE OR REPLACE FUNCTION public.set_execution_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.number IS NULL THEN
    SELECT COALESCE(MAX(number), 0) + 1
    INTO NEW.number
    FROM public.executions
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Create BEFORE INSERT trigger on public.executions
DROP TRIGGER IF EXISTS set_execution_number_before_insert ON public.executions;

CREATE TRIGGER set_execution_number_before_insert
  BEFORE INSERT ON public.executions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_execution_number();

-- 4. Create compound index for fast per-user max number lookups
CREATE INDEX IF NOT EXISTS idx_executions_user_id_number ON public.executions(user_id, number DESC);
