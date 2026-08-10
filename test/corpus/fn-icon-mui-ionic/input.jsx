import { ArrowBack, ArrowForward, NavigateNext, NavigateBefore } from "@mui/icons-material";
export const Pager = () => (
  <nav>
    <ArrowBack />
    <NavigateBefore />
    <NavigateNext />
    <ArrowForward />
  </nav>
);
const ArrowBackground = 1; // must NOT match (Background is a longer word)
