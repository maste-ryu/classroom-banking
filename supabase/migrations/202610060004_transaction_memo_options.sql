-- Teacher-managed options for the memo dropdown on reward and penalty entries.
alter table public.classrooms
  add column transaction_memo_options text[] not null
    default array['完成作業', '協助班級工作']::text[],
  add constraint classrooms_transaction_memo_options_count_check
    check (
      cardinality(transaction_memo_options) between 1 and 30
      and array_position(transaction_memo_options, null) is null
    );

grant update (transaction_memo_options)
  on public.classrooms to authenticated;
