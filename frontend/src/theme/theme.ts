import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1E3A5F",
      light: "#456A91",
      dark: "#10263F",
      contrastText: "#FFFFFF",
    },
    secondary: {
      main: "#2E7D6B",
      light: "#58A894",
      dark: "#1D5145",
      contrastText: "#FFFFFF",
    },
    background: {
      default: "#F4F7FA",
      paper: "#FFFFFF",
    },
    text: {
      primary: "#1F2933",
      secondary: "#5B6773",
    },
    error: {
      main: "#C62828",
    },
    success: {
      main: "#2E7D32",
    },
    warning: {
      main: "#ED6C02",
    },
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: ["Montserrat", "Arial", "sans-serif"].join(","),
    h1: {
      fontWeight: 700,
    },
    h2: {
      fontWeight: 700,
    },
    h3: {
      fontWeight: 700,
    },
    h4: {
      fontWeight: 700,
    },
    h5: {
      fontWeight: 700,
    },
    h6: {
      fontWeight: 700,
    },
    button: {
      textTransform: "none",
      fontWeight: 600,
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          paddingTop: 10,
          paddingBottom: 10,
          boxShadow: "none",
        },
      },
      defaultProps: {
        disableElevation: true,
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 24,
          boxShadow: "0 12px 32px rgba(15, 23, 42, 0.08)",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 24,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: "outlined",
        fullWidth: true,
      },
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 14,
            backgroundColor: "#FFFFFF",
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 14,
        },
      },
    },
  },
});
